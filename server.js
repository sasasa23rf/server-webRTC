const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- CONFIGURAZIONE GLOBALE CONDIVISA ---
// Questi sono i valori di default. Verranno sovrascritti se qualcuno li cambia dalla UI.
let currentConfig = {
    target_fps: 50,
    width: 640,
    height: 480,
    jpeg_quality: 50
};

app.get('/', (req, res) => {
    res.send('Server Ponte Video Attivo! Configurazione corrente: ' + JSON.stringify(currentConfig));
});

io.on('connection', (socket) => {
    console.log('Nuovo client connesso:', socket.id);

    // 1. APPENA CONNESSO: Invia la configurazione attuale al nuovo client (sia esso chi guarda o il Raspberry)
    socket.emit('config_updated', currentConfig);

    // 2. RICEZIONE FRAME: Quando arriva un frame dal Raspberry
    socket.on('video_frame', (data) => {
        socket.broadcast.emit('stream_display', data);
    });

    // 3. RICHIESTA CONFIG: Se un client chiede esplicitamente la config
    socket.on('get_config', () => {
        socket.emit('config_updated', currentConfig);
    });

    // 4. AGGIORNAMENTO CONFIG: Quando l'utente cambia la qualità dal sito
    socket.on('update_config', (newConfig) => {
        console.log('Nuova configurazione ricevuta:', newConfig);
        
        // Aggiorniamo la configurazione in memoria (unendo i vecchi valori con i nuovi)
        currentConfig = { ...currentConfig, ...newConfig };

        // Avvisiamo TUTTI (Soprattutto il Raspberry Pi) che la config è cambiata
        io.emit('config_updated', currentConfig);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnesso:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
});
