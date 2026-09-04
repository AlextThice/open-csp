import { createConnection, createServer } from 'node:net';
// Docker Desktop fixture ports are bound only to the host loopback interface.
// The application's endpoints remain loopback-only inside this disposable container.
for (const port of [22222, 29000]) {
  createServer((incoming) => {
    const outgoing = createConnection({ host: 'host.docker.internal', port });
    incoming.on('error', () => outgoing.destroy());
    outgoing.on('error', () => incoming.destroy());
    incoming.on('close', () => outgoing.destroy());
    outgoing.on('close', () => incoming.destroy());
    incoming.pipe(outgoing).pipe(incoming);
  }).listen(port, '127.0.0.1');
}
