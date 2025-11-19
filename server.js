const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

let sender = null;
let receiver = null;

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register-sender', () => {
    sender = socket.id;
    console.log('Sender registered:', sender);
    socket.emit('registered', { role: 'sender' });
    
    // Notifica sia il receiver che il sender è pronto
    if (receiver) {
      io.to(receiver).emit('sender-ready');
      // Notifica il sender che può iniziare (receiver già connesso)
      socket.emit('receiver-ready');
    }
  });

  socket.on('register-receiver', () => {
    receiver = socket.id;
    console.log('Receiver registered:', receiver);
    socket.emit('registered', { role: 'receiver' });
    
    if (sender) {
      socket.emit('sender-ready');
    }
  });

  socket.on('offer', (data) => {
    console.log('Offer received from sender');
    if (receiver) {
      io.to(receiver).emit('offer', data);
    }
  });

  socket.on('answer', (data) => {
    console.log('Answer received from receiver');
    if (sender) {
      io.to(sender).emit('answer', data);
    }
  });

  socket.on('ice-candidate', (data) => {
    console.log('ICE candidate received');
    
    // CORREZIONE: Crea un payload piatto con i campi essenziali per WebRTC.
    // Questo previene l'annidamento errato e garantisce l'inoltro di tutti i dati.
    const candidatePayload = {
      candidate: data.candidate,
      sdpMid: data.sdpMid,
      sdpMLineIndex: data.sdpMLineIndex
    };

    if (data.target === 'sender' && sender) {
      // Inoltra l'intero oggetto candidato al sender (sender.py)
      io.to(sender).emit('ice-candidate', candidatePayload);
    } else if (data.target === 'receiver' && receiver) {
      // Inoltra l'intero oggetto candidato al receiver (index.html)
      io.to(receiver).emit('ice-candidate', candidatePayload);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (socket.id === sender) {
      sender = null;
      if (receiver) {
        io.to(receiver).emit('sender-disconnected');
      }
    } else if (socket.id === receiver) {
      receiver = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
