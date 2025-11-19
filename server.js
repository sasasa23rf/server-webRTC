const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 1234 });

let sender = null;
let receiver = null;

wss.on('connection', ws => {
  ws.on('message', message => {
    const data = JSON.parse(message);

    if (data.role === 'sender') {
      sender = ws;
    } else if (data.role === 'receiver') {
      receiver = ws;
    }

    if (data.sdp && receiver && sender) {
      if (ws === sender) {
        receiver.send(JSON.stringify({ sdp: data.sdp }));
      } else {
        sender.send(JSON.stringify({ sdp: data.sdp }));
      }
    }

    if (data.candidate && receiver && sender) {
      if (ws === sender) {
        receiver.send(JSON.stringify({ candidate: data.candidate }));
      } else {
        sender.send(JSON.stringify({ candidate: data.candidate }));
      }
    }
  });
});
