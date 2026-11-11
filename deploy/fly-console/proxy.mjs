// Public front door for the demo on Fly. The console listens on loopback only, by design, so this proxy listens on the
// public port and forwards every request, including the live event stream, to the console on 127.0.0.1.
import http from 'node:http';

const CONSOLE = { host: '127.0.0.1', port: 4180 };

http
  .createServer((req, res) => {
    const upstream = http.request(
      { ...CONSOLE, path: req.url, method: req.method, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('The console is starting. Try again in a moment.');
    });
    req.pipe(upstream);
  })
  .listen(8080, '0.0.0.0', () => console.log('proxy on 8080 to the console on 127.0.0.1:4180'));
