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

    // 1. Invia config iniziale
    socket.emit('config_updated', currentConfig);

    // 2. STREAMING VIDEO (Raspberry -> Browser)
    socket.on('video_frame', (data) => {
        socket.broadcast.emit('stream_display', data);
    });

    // 3. CONFIGURAZIONE (Browser <-> Server <-> Raspberry)
    socket.on('get_config', () => {
        socket.emit('config_updated', currentConfig);
    });

    socket.on('update_config', (newConfig) => {
        console.log('Nuova configurazione ricevuta:', newConfig);
        currentConfig = { ...currentConfig, ...newConfig };
        io.emit('config_updated', currentConfig);
    });

    // 4. SISTEMA VELOCITÀ (Nuovo)
    // Il browser attiva/disattiva il monitoraggio
    socket.on('toggle_speed_monitoring', (isActive) => {
        console.log(`Richiesta monitoraggio velocità: ${isActive}`);
        // Inoltriamo il comando a TUTTI i dispositivi (incluso il Raspberry con velocita.py)
        io.emit('set_speed_monitoring', isActive);
    });

    // Il Raspberry invia i dati di velocità
    socket.on('speed_data', (data) => {
        // Inoltriamo i dati al browser per mostrarli
        socket.broadcast.emit('display_speed', data);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnesso:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
});
