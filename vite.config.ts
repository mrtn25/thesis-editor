import { defineConfig, loadEnv, type Plugin } from 'vite';
import fs from 'node:fs';

// Local development only: serve the .docx named in SAMPLE_DOCX (in .env) at /api/sample,
// so the "Beispiel laden" button works. Not part of the production build.
function sampleDocx(path: string | undefined): Plugin {
  return {
    name: 'sample-docx',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/sample', (_req, res) => {
        if (!path || !fs.existsSync(path)) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        fs.createReadStream(path).pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [sampleDocx(env.SAMPLE_DOCX)],
    server: { port: 5180 },
  };
});
