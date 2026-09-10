import type { HandoffObservation } from "../contracts/handoff";
import type { NormalizedEventInput } from "../storage/normalizerRepository";
import { INFERENCE_VERSION, schemaCoverageReasons, validObservedDate, type InferredSchema } from "../normalization/schemaInference";
import { CAPTURE_CONTRACT, safeCaptureName, safeCaptureString, isSafeCaptureJson, captureHash, captureRequestSafe, type BaselineCapture, type CaptureRequest, type ArrayState } from "./safeCapture";
// Independent self-check against the transient typed sample. No response values are persisted.
function sampleCompatible(value: unknown, s: InferredSchema): boolean {
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.includes(kind) && !(kind === 'integer' && types.includes('number')))
        return false;
    if (typeof value === 'string' && s.format === 'date' && !validObservedDate(value))
        return false;
    if (typeof value === 'string' && s.format === 'date-time' && !Number.isFinite(Date.parse(value)))
        return false;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const v = value as Record<string, unknown>;
        if ((s['x-qagent-observed-required'] || []).some(k => !Object.prototype.hasOwnProperty.call(v, k)))
            return false;
        for (const [k, child] of Object.entries(s.properties || {}))
            if (Object.prototype.hasOwnProperty.call(v, k) && !sampleCompatible(v[k], child))
                return false;
    }
    if (Array.isArray(value) && s.items && !value.every(v => sampleCompatible(v, s.items!)))
        return false;
    return true;
}
export async function buildObservedBaselineCapture(observation: HandoffObservation, event: NormalizedEventInput): Promise<BaselineCapture | null> {
    if (event.networkFailure || event.statusCode === null || event.statusCode < 200 || event.statusCode > 299)
        return null;
    const reasons = new Set<string>();
    if (event.authObserved === null || event.authObserved === undefined)
        reasons.add('AUTH_CONTEXT_UNAVAILABLE');
    const req: CaptureRequest = { query: {}, pathParams: {}, headers: {} };
    const url = new URL(observation.safeUrl);
    const keys = [...new Set(url.searchParams.keys())];
    if (keys.length > 48)
        reasons.add('REQUEST_LIMIT');
    for (const k of keys.slice(0, 48)) {
        if (!safeCaptureName(k)) {
            reasons.add('REQUEST_DATA_UNSAFE_OR_UNSUPPORTED');
            continue;
        }
        if (url.searchParams.getAll(k).length > 1) {
            reasons.add('REPEATED_QUERY_UNAVAILABLE');
            continue;
        }
        // Use only the dedicated safe sample. A redacted URL is not a source of secret replay data.
        const v = observation.requestQuerySample?.values?.[k];
        if (typeof v !== 'string') {
            reasons.add('REQUEST_QUERY_UNAVAILABLE');
            continue;
        }
        if (!safeCaptureString(v)) {
            reasons.add('REQUEST_DATA_UNSAFE_OR_UNSUPPORTED');
            continue;
        }
        req.query[k] = v; // lexical representation preserved: 1.00 remains 1.00.
    }
    const placeholders = [...event.normalizedPath.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(x => x[1]!);
    for (const key of placeholders) {
        if (placeholders.filter(x => x === key).length > 1) {
            reasons.add('REPEATED_PATH_UNSUPPORTED');
            continue;
        }
        const candidate = event.observedTestData?.values.find(x => x.target === 'PATH_PARAM' && x.selector === key);
        if (!candidate || typeof candidate.value !== 'string' || !safeCaptureName(key) || !safeCaptureString(candidate.value))
            reasons.add('REQUEST_PATH_UNAVAILABLE');
        else
            req.pathParams[key] = candidate.value;
    }
    let encoding: BaselineCapture['requestBodyEncoding'] = 'NONE';
    const body = observation.requestSample;
    if (body?.truncated)
        reasons.add('REQUEST_BODY_TRUNCATED');
    if (body?.body != null && body.body !== '') {
        if (['GET', 'HEAD', 'OPTIONS'].includes(event.method))
            reasons.add('BODY_ON_SAFE_METHOD');
        const ct = event.requestContentType || '';
        if (ct.includes('json')) {
            encoding = 'JSON';
            req.headers['content-type'] = 'application/json';
            try {
                const value = JSON.parse(body.body);
                if (!isSafeCaptureJson(value))
                    reasons.add('REQUEST_DATA_UNSAFE_OR_UNSUPPORTED');
                else
                    req.body = value;
            }
            catch {
                reasons.add('REQUEST_BODY_UNAVAILABLE');
            }
        }
        else if (ct === 'application/x-www-form-urlencoded') {
            encoding = 'FORM_URLENCODED';
            req.headers['content-type'] = ct;
            const params = new URLSearchParams(body.body);
            const entries = [...params.entries()];
            if (entries.length > 48 || entries.some(([k, v]) => !safeCaptureName(k) || !safeCaptureString(v)))
                reasons.add('REQUEST_DATA_UNSAFE_OR_UNSUPPORTED');
            else {
                const text = params.toString();
                if (text.length <= 256)
                    req.body = text;
                else
                    reasons.add('REQUEST_LIMIT');
            }
        }
        else {
            encoding = 'UNSUPPORTED';
            reasons.add('REQUEST_BODY_UNAVAILABLE');
        }
    }
    else if (!['GET', 'HEAD', 'OPTIONS'].includes(event.method)) {
        // The legacy capture does not distinguish an intentionally empty mutation body from a suppressed one.
        reasons.add('REQUEST_BODY_UNAVAILABLE');
    }
    if (!captureRequestSafe(req as unknown)) {
        delete req.body;
        req.query = {};
        req.pathParams = {};
        reasons.add('REQUEST_LIMIT');
    }
    const responseReasons = new Set(schemaCoverageReasons(event.responseSchema));
    if (observation.responseSample?.truncated)
        responseReasons.add('BODY_TRUNCATED');
    const noBody = event.statusCode === 204 || event.statusCode === 205 || event.method === 'HEAD';
    let selfCheck: BaselineCapture['selfCheck'] = 'PARTIAL';
    const states = new Map<string, Set<string>>();
    let nodes = 0;
    function profile(v: unknown, p: string, depth = 0): void {
        if (++nodes > 512 || depth > 8 || states.size > 32) {
            responseReasons.add('PROFILE_LIMIT');
            return;
        }
        if (Array.isArray(v)) {
            const st = states.get(p) || new Set<string>();
            st.add(v.length ? 'NON_EMPTY' : 'EMPTY');
            states.set(p, st);
            for (const item of v.slice(0, 20))
                profile(item, p + '[*]', depth + 1);
        }
        else if (v && typeof v === 'object') {
            for (const [k, x] of Object.entries(v))
                if (safeCaptureName(k) && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(k))
                    profile(x, p + '.' + k, depth + 1);
        }
    }
    if (noBody)
        selfCheck = 'NO_BODY';
    else if (!event.responseSchema || !observation.responseSample?.body)
        responseReasons.add('RESPONSE_UNAVAILABLE');
    else {
        try {
            const parsed = JSON.parse(observation.responseSample.body);
            profile(parsed, '$');
            if (!responseReasons.size)
                selfCheck = sampleCompatible(parsed, event.responseSchema) ? 'PASSED' : 'FAILED';
        }
        catch {
            responseReasons.add('RESPONSE_UNAVAILABLE');
        }
    }
    const arrayStates: ArrayState[] = [...states].slice(0, 32).map(([path, s]): ArrayState => ({ path, state: s.size > 1 ? 'MIXED' : ([...s][0] as 'EMPTY' | 'NON_EMPTY') })).sort((a, b) => a.path.localeCompare(b.path));
    return {
        contractVersion: CAPTURE_CONTRACT, inferenceVersion: INFERENCE_VERSION, request: req,
        requestFingerprint: 'brq_' + await captureHash({ request: req, encoding }), fingerprintScope: 'CANONICAL_CAPTURED_REQUEST_DATA', requestBodyEncoding: encoding,
        requestCoverage: { status: reasons.size ? 'PARTIAL' : 'COMPLETE', reasons: [...reasons].sort(), headers: 'AUTH_RUNTIME_AND_CONFIG' },
        responseCoverage: { status: noBody ? 'NO_BODY' : responseReasons.size ? 'PARTIAL' : 'COMPLETE', reasons: [...responseReasons].sort() },
        arrayStates, selfCheck,
    };
}
