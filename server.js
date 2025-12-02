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

// ⭐ NUOVE VARIABILI PER LA GESTIONE ANTI-LAG DEL SERVER ⭐
// Queste variabili servono a garantire che solo l'ultimo frame ricevuto venga inoltrato.
let lastFrameData = null;      
let isSendingFrame = false;    

// ⭐ FUNZIONE CHE INVIA SOLO L'ULTIMO FRAME RICEVUTO (MASSIMA REATTIVITÀ) ⭐
function sendLatestFrame() {
    // 1. Controlla se c'è un frame da inviare E se non siamo già in fase di invio
    if (!lastFrameData || isSendingFrame) {
        return;
    }

    // Blocca l'invio per evitare la spedizione di frame multipli contemporaneamente
    isSendingFrame = true; 
    
    const frameToSend = lastFrameData; // Preleva il frame più recente
    lastFrameData = null;              // ⭐ SVUOTA il buffer per scartare i frame vecchi in arrivo ⭐
    
    // Invia il frame a tutti i client (browser)
    io.emit('stream_display', frameToSend); 

    // 2. Dopo un ritardo minimo (1ms), sblocca l'invio.
    // Il ritardo minimo assicura che il server sia reattivo ma non blocchi il ciclo.
    setTimeout(() => {
        isSendingFrame = false;
        
        // 3. Se nel frattempo è arrivato un frame NUOVO, lo inviamo immediatamente
        if (lastFrameData) { 
            sendLatestFrame();
        }
    }, 1); // Ritardo minimo per massima reattività (Nessun blocco basato su FPS)
}


app.get('/', (req, res) => {
    res.send('Server Ponte Video Attivo! Configurazione corrente: ' + JSON.stringify(currentConfig));
});

io.on('connection', (socket) => {
    console.log('Nuovo client connesso:', socket.id);

    // 1. Invia config iniziale
    socket.emit('config_updated', currentConfig);

    // 2. STREAMING VIDEO (Raspberry -> Browser)
    socket.on('video_frame', (data) => {
        // ⭐ NUOVA LOGICA: Aggiorna solo il frame più recente e tenta l'invio immediato.
        lastFrameData = data;
        sendLatestFrame();
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
