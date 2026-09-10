// Local Node checks against transpiled source; no claim of Cloudflare runtime emulation.
const fs=require('fs'),path=require('path'),os=require('os'),ts=require('typescript');
const repo=path.resolve(__dirname,'../..'),src=path.join(repo,'src'),dst=fs.mkdtempSync(path.join(os.tmpdir(),'qagent-0816-'));
fs.writeFileSync(path.join(dst,'package.json'),'\u007b"type":"commonjs"\u007d');
function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,ent.name);if(ent.isDirectory())walk(full);else if(full.endsWith('.ts')&&!full.endsWith('.d.ts')){
 const out=path.join(dst,path.relative(src,full).replace(/\.ts$/,'.js'));fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,ts.transpileModule(fs.readFileSync(full,'utf8'),{fileName:full,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
}}}walk(src);process.on('exit',()=>fs.rmSync(dst,{recursive:true,force:true}));module.exports={load:relative=>require(path.join(dst,relative+'.js'))};
