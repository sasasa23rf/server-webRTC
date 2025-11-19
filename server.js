// server.js
const WebSocket = require('ws');

const PORT = process.env.PORT || 1234;
const wss = new WebSocket.Server({ port: PORT });

let sender = null;
let receiver = null;

function safeSend(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on('listening', () => {
  console.log('Server: WebSocket in ascolto sulla porta', PORT);
});

wss.on('connection', (ws) => {
  console.log('Server: nuovo client connesso');

  ws.on('message', (message) => {
    let data;
    try { data = JSON.parse(message); } catch (e) {
      console.log('Server: messaggio non JSON, ignorato.');
      return;
    }

    if (data.role === 'sender') {
      sender = ws;
      console.log('Server: sender collegato');
    } else if (data.role === 'receiver') {
      receiver = ws;
      console.log('Server: receiver collegato');
    }

    if (data.sdp) {
      console.log(`Server: SDP ${data.sdp.type} ricevuta da ${data.role}, inoltro...`);
      if (data.role === 'sender' && receiver) safeSend(receiver, { sdp: data.sdp });
      if (data.role === 'receiver' && sender) safeSend(sender, { sdp: data.sdp });
    }

    // Non usiamo trickle ICE: nessun inoltro di candidate singoli
    if (data.candidate) {
      console.log(`Server: candidate ricevuto da ${data.role} (non usato in questa configurazione senza trickle).`);
    }
  });

  ws.on('close', () => {
    if (ws === sender) { sender = null; console.log('Server: sender disconnesso'); }
    if (ws === receiver) { receiver = null; console.log('Server: receiver disconnesso'); }
  });
});
