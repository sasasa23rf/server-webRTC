const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configurazione ExpressTURN
const TURN_CONFIG = {
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    {
      urls: 'turn:expressturn.com:3450',
      username: '000000000007829535',
      credential: 'X.4BvxAe8E7tgVf9FKHnGQzHY3Zs'
    }
  ]
};

// Route principale - serve HTML direttamente
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebRTC Video Streaming</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            text-align: center;
        }
        .video-container {
            display: flex;
            flex-direction: column;
            gap: 20px;
            margin: 20px 0;
        }
        video {
            width: 100%;
            max-width: 800px;
            height: auto;
            border: 2px solid #ddd;
            border-radius: 8px;
            background: #000;
            margin: 0 auto;
            display: block;
        }
        .controls {
            display: flex;
            gap: 10px;
            justify-content: center;
            margin: 20px 0;
            flex-wrap: wrap;
        }
        button {
            padding: 10px 20px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
        }
        button:hover {
            background: #0056b3;
        }
        button:disabled {
            background: #6c757d;
            cursor: not-allowed;
        }
        .status {
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
            text-align: center;
        }
        .status.connected {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .status.disconnected {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .status.connecting {
            background: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        .info {
            background: #e9ecef;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
            font-size: 14px;
        }
        .log {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
            font-family: monospace;
            font-size: 12px;
            height: 100px;
            overflow-y: auto;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>WebRTC Video Streaming con ExpressTURN</h1>
        
        <div class="info">
            <strong>Server TURN:</strong> expressturn.com:3450<br>
            <strong>Render URL:</strong> https://server-webrtc-mvno.onrender.com<br>
            <strong>Status:</strong> <span id="serverStatus">Connesso al server</span>
        </div>

        <div id="status" class="status disconnected">
            Disconnesso - Clicca "Connetti WebRTC" per iniziare
        </div>

        <div class="video-container">
            <div>
                <h3>Video Stream (Simulato)</h3>
                <video id="remoteVideo" autoplay muted playsinline></video>
            </div>
        </div>

        <div class="controls">
            <button id="connectBtn" onclick="connectWebRTC()">Connetti WebRTC</button>
            <button id="disconnectBtn" onclick="disconnectWebRTC()" disabled>Disconnetti</button>
            <button id="testBtn" onclick="testVideo()">Test Video</button>
        </div>

        <div class="info">
            <h4>Informazioni di connessione:</h4>
            <div id="connectionInfo">In attesa di connessione WebRTC...</div>
        </div>

        <div class="log">
            <div id="logContent">Log della connessione:\n</div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        let socket;
        let peerConnection;
        let turnConfig;
        let isConnected = false;

        const remoteVideo = document.getElementById('remoteVideo');
        const connectBtn = document.getElementById('connectBtn');
        const disconnectBtn = document.getElementById('disconnectBtn');
        const statusDiv = document.getElementById('status');
        const connectionInfo = document.getElementById('connectionInfo');
        const logContent = document.getElementById('logContent');
        const serverStatus = document.getElementById('serverStatus');

        function log(message) {
            const timestamp = new Date().toLocaleTimeString();
            logContent.innerHTML += `[${timestamp}] ${message}\\n`;
            logContent.scrollTop = logContent.scrollHeight;
        }

        // Inizializza Socket.io
        function initializeSocket() {
            socket = io();
            
            socket.on('connect', () => {
                log('Connesso al server Socket.io');
                serverStatus.textContent = 'Connesso';
                serverStatus.style.color = 'green';
            });

            socket.on('turn-config', (config) => {
                turnConfig = config;
                log('Configurazione TURN ricevuta');
                connectionInfo.innerHTML = 
                    '<strong>ICE Servers configurati:</strong><br>' +
                    '- STUN: stun.l.google.com:19302<br>' +
                    '- TURN: expressturn.com:3450<br>' +
                    '<strong>Stato:</strong> Pronto per la connessione WebRTC';
            });

            socket.on('offer', async (data) => {
                log('Offer ricevuta dal server');
                await handleOffer(data);
            });

            socket.on('answer', async (data) => {
                log('Answer ricevuta dal server');
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(data);
                }
            });

            socket.on('ice-candidate', (data) => {
                log('ICE candidate ricevuto');
                if (peerConnection) {
                    peerConnection.addIceCandidate(data);
                }
            });

            socket.on('disconnect', () => {
                log('Disconnesso dal server');
                serverStatus.textContent = 'Disconnesso';
                serverStatus.style.color = 'red';
                updateStatus('Disconnesso dal server', 'disconnected');
                isConnected = false;
            });
        }

        // Aggiorna lo stato della connessione
        function updateStatus(message, type) {
            statusDiv.textContent = message;
            statusDiv.className = 'status ' + type;
            log('Stato: ' + message);
        }

        // Crea la connessione peer
        function createPeerConnection() {
            const config = {
                iceServers: turnConfig.iceServers
            };

            peerConnection = new RTCPeerConnection(config);

            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    log('Invio ICE candidate');
                    socket.emit('ice-candidate', event.candidate);
                }
            };

            peerConnection.ontrack = (event) => {
                log('Stream remoto ricevuto');
                remoteVideo.srcObject = event.streams[0];
                updateStatus('Streaming video attivo', 'connected');
            };

            peerConnection.onconnectionstatechange = () => {
                const state = peerConnection.connectionState;
                log('Stato connessione WebRTC: ' + state);
                
                if (state === 'connected') {
                    isConnected = true;
                    connectBtn.disabled = true;
                    disconnectBtn.disabled = false;
                    updateStatus('Connessione WebRTC stabilita', 'connected');
                } else if (state === 'disconnected' || state === 'failed') {
                    isConnected = false;
                    connectBtn.disabled = false;
                    disconnectBtn.disabled = true;
                    updateStatus('Connessione WebRTC persa', 'disconnected');
                }
            };

            peerConnection.oniceconnectionstatechange = () => {
                log('Stato ICE: ' + peerConnection.iceConnectionState);
            };
        }

        // Gestisce l'offerta ricevuta
        async function handleOffer(offer) {
            if (!peerConnection) {
                createPeerConnection();
            }

            try {
                await peerConnection.setRemoteDescription(offer);
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('answer', answer);
                log('Answer inviata al server');
            } catch (error) {
                log('Errore nella gestione dell\'offerta: ' + error);
            }
        }

        // Connetti via WebRTC
        async function connectWebRTC() {
            if (!peerConnection) {
                createPeerConnection();
            }

            try {
                updateStatus('Creando offerta WebRTC...', 'connecting');
                log('Creazione offerta WebRTC...');
                
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('offer', offer);
                
                log('Offerta WebRTC inviata al server');
                updateStatus('Offerta WebRTC inviata - in attesa di risposta', 'connecting');
                
            } catch (error) {
                log('Errore connessione WebRTC: ' + error);
                updateStatus('Errore connessione WebRTC', 'disconnected');
            }
        }

        // Disconnetti WebRTC
        function disconnectWebRTC() {
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            
            if (remoteVideo.srcObject) {
                remoteVideo.srcObject = null;
            }
            
            connectBtn.disabled = false;
            disconnectBtn.disabled = true;
            updateStatus('Connessione WebRTC chiusa', 'disconnected');
            isConnected = false;
            log('Connessione WebRTC chiusa');
        }

        // Test video locale
        function testVideo() {
            // Crea un video di test (canvas con pattern)
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 480;
            const ctx = canvas.getContext('2d');
            
            // Disegna un pattern di test
            ctx.fillStyle = '#2c3e50';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            ctx.fillStyle = '#e74c3c';
            ctx.font = 'bold 48px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('WEBRTC TEST', canvas.width/2, canvas.height/2);
            
            ctx.fillStyle = '#ecf0f1';
            ctx.font = '24px Arial';
            ctx.fillText('ExpressTURN + Render', canvas.width/2, canvas.height/2 + 50);
            
            // Converti in stream
            const stream = canvas.captureStream(25);
            remoteVideo.srcObject = stream;
            
            log('Video di test attivato');
            updateStatus('Video di test attivo', 'connected');
        }

        // Inizializza l'applicazione quando la pagina è caricata
        window.addEventListener('load', () => {
            initializeSocket();
            updateStatus('Inizializzazione completata', 'connecting');
            log('Applicazione WebRTC inizializzata');
            log('Server: https://server-webrtc-mvno.onrender.com');
            log('TURN: expressturn.com:3450');
        });
    </script>
</body>
</html>
  `);
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Server WebRTC is running',
    turn: 'expressturn.com:3450'
  });
});

// Gestione connessioni Socket.io
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Invia configurazione TURN al client
  socket.emit('turn-config', TURN_CONFIG);

  // Gestione offerta WebRTC
  socket.on('offer', (data) => {
    console.log('Offer received from client:', socket.id);
    // Inoltra l'offerta ad altri client (per connessioni P2P)
    socket.broadcast.emit('offer', data);
  });

  // Gestione risposta WebRTC
  socket.on('answer', (data) => {
    console.log('Answer received from client:', socket.id);
    socket.broadcast.emit('answer', data);
  });

  // Gestione ICE candidates
  socket.on('ice-candidate', (data) => {
    socket.broadcast.emit('ice-candidate', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the application at: http://localhost:${PORT}`);
  console.log(`TURN Server: expressturn.com:3450`);
});
