import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectId = process.env.GPT_SITES_PROJECT_ID;
if (!/^appgprj_[a-z0-9]+$/.test(projectId ?? '')) {
  throw new Error('Set GPT_SITES_PROJECT_ID to the destination GPT Sites project ID.');
}

const root = new URL('../../', import.meta.url);
const output = new URL('sites/dist/', root);
const files = {
  '/': ['graph/index.html', 'text/html'],
  '/style.css': ['graph/style.css', 'text/css'],
  '/orders/': ['orders/worker/page.html', 'text/html'],
};
for (const name of ['app', 'autoconnect', 'persistence', 'serial', 'session', 'window']) {
  files['/' + name + '.mjs'] = ['graph/' + name + '.mjs', 'text/javascript'];
}
for (const name of ['app', 'erp', 'erp-service']) {
  files['/orders/' + name + '.js'] = ['orders/worker/' + name + '.js', 'text/javascript'];
  files['/orders/' + name + '.css'] = ['orders/worker/' + name + '.css', 'text/css'];
}
const assets = {};
for (const [path, [source, type]] of Object.entries(files)) {
  let content = await readFile(new URL(source, root), 'utf8');
  if (path === '/') content = content.replace('프로그램 폴더의 data 폴더에', '서버에')
    .replace('id="history-import" type="button" class="secondary" hidden',
      'id="history-import" type="button" class="secondary"');
  assets[path] = [content, type];
}
await rm(output,{recursive:true,force:true});
await mkdir(new URL('server/',output),{recursive:true});
await mkdir(new URL('.openai/',output),{recursive:true});
await build({
  entryPoints:[fileURLToPath(new URL('sites/worker.mjs',root))],
  outfile:fileURLToPath(new URL('server/index.js',output)),
  bundle:true, platform:'browser', format:'esm', target:'es2022',
  plugins:[{
    name:'sites-assets',
    setup(builder) {
      builder.onResolve({filter:/^\.\/assets\.mjs$/},() => ({path:'assets',namespace:'sites'}));
      builder.onLoad({filter:/^assets$/,namespace:'sites'},() => ({
        contents:'export const assets = ' + JSON.stringify(assets),
        loader:'js',
      }));
    },
  }],
});
const migrations = new URL('server/drizzle/',output);
await cp(new URL('orders/drizzle/',root),migrations,{recursive:true});
await cp(new URL('sites/0002_shot_history.sql',root),new URL('0002_shot_history.sql',migrations));
const journal = JSON.parse(await readFile(new URL('meta/_journal.json',migrations),'utf8'));
journal.entries.push({idx:2,version:journal.entries.at(-1).version,when:1795737600000,tag:'0002_shot_history',breakpoints:true});
await writeFile(new URL('meta/_journal.json',migrations),JSON.stringify(journal,null,2) + '\n');
await writeFile(new URL('.openai/hosting.json',output), JSON.stringify({project_id:projectId,d1:'DB',r2:null},null,2) + '\n');
