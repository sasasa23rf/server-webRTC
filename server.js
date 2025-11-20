const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const mediasoup = require('mediasoup');

// Configurazione base
let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

// Configurazione Media Codecs
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000
    }
  }
];

// 1. Avviare il Worker di Mediasoup
async function startMediasoup() {
  try {
    worker = await mediasoup.createWorker({
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
    });
    
    worker.on('died', () => {
      console.error('mediasoup worker died');
      process.exit(1);
    });

    console.log('✅ Worker Mediasoup creato');

    router = await worker.createRouter({ mediaCodecs });
    console.log('✅ Router Mediasoup creato');
  } catch (error) {
    console.error('❌ Errore avvio Mediasoup:', error);
    process.exit(1);
  }
}

startMediasoup();

// Middleware per logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Route di test
app.get('/', (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>Mediasoup Server 🟢</h1>
        <p>Server WebRTC attivo e funzionante</p>
        <p>Usa il client HTML per connetterti</p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mediasoup: worker ? 'active' : 'inactive',
    router: router ? 'active' : 'inactive'
  });
});

// Gestione Socket.io
io.on('connection', async (socket) => {
  console.log('🔌 Nuovo client connesso:', socket.id);

  // Invia le capacità RTP al client
  socket.emit('routerRtpCapabilities', router.rtpCapabilities);
  console.log('📋 RTP capabilities inviate a', socket.id);

  // Creazione del Transport
  socket.on('createTransport', async ({ sender }, callback) => {
    console.log(`🚚 Richiesto transport per ${socket.id} (sender: ${sender})`);
    
    try {
      if (sender) {
        producerTransport = await createWebRtcTransport(socket.id, callback);
        console.log(`✅ Producer transport creato per ${socket.id}`);
      } else {
        consumerTransport = await createWebRtcTransport(socket.id, callback);
        console.log(`✅ Consumer transport creato per ${socket.id}`);
      }
    } catch (error) {
      console.error(`❌ Errore creazione transport per ${socket.id}:`, error);
      callback({ error: error.message });
    }
  });

  // Connessione del Transport
  socket.on('connectTransport', async ({ dtlsParameters, sender }, callback) => {
    console.log(`🔗 Connessione transport per ${socket.id} (sender: ${sender})`);
    
    try {
      if (sender) {
        await producerTransport.connect({ dtlsParameters });
        console.log(`✅ Producer transport connesso per ${socket.id}`);
      } else {
        await consumerTransport.connect({ dtlsParameters });
        console.log(`✅ Consumer transport connesso per ${socket.id}`);
      }
      if (callback) callback({ success: true });
    } catch (error) {
      console.error(`❌ Errore connessione transport per ${socket.id}:`, error);
      if (callback) callback({ error: error.message });
    }
  });

  // Broadcaster: Inizia a produrre video
  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    console.log(`🎬 Produce richiesto da ${socket.id} (${kind})`);
    
    try {
      producer = await producerTransport.produce({ kind, rtpParameters });
      
      producer.on('transportclose', () => {
        console.log(`🚪 Producer transport chiuso per ${socket.id}`);
        producer.close();
      });

      producer.on('trackended', () => {
        console.log(`⏹️ Traccia terminata per ${socket.id}`);
        socket.broadcast.emit('producerClosed');
      });

      console.log(`✅ Producer creato per ${socket.id}:`, producer.id);
      callback({ id: producer.id });
      
      // Avvisa tutti gli altri che c'è uno stream disponibile
      socket.broadcast.emit('newProducer', { producerId: producer.id });
      console.log(`📢 Nuovo producer annunciato: ${producer.id}`);
      
    } catch (error) {
      console.error(`❌ Errore produzione per ${socket.id}:`, error);
      callback({ error: error.message });
    }
  });

  // Viewer: Inizia a consumare video
  socket.on('consume', async ({ rtpCapabilities }, callback) => {
    console.log(`👀 Consume richiesto da ${socket.id}`);
    
    try {
      if (!producer) {
        console.warn(`⚠️ Nessun producer attivo per ${socket.id}`);
        callback({ error: 'No active producer' });
        return;
      }

      if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        console.warn(`❌ Impossibile consumare stream per ${socket.id}`);
        callback({ error: 'Cannot consume this stream' });
        return;
      }

      consumer = await consumerTransport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: true,
      });

      consumer.on('transportclose', () => {
        console.log(`🚪 Consumer transport chiuso per ${socket.id}`);
      });

      consumer.on('producerclose', () => {
        console.log(`📴 Producer ha chiuso lo stream per ${socket.id}`);
        socket.emit('producerClosed');
        consumer.close();
      });

      console.log(`✅ Consumer creato per ${socket.id}:`, consumer.id);

      // Rispondi al client con i parametri
      callback({
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      });

      // Avvia il video
      await consumer.resume();
      console.log(`▶️ Consumer avviato per ${socket.id}`);
      
    } catch (error) {
      console.error(`❌ Errore nel consumo per ${socket.id}:`, error);
      callback({ error: error.message });
    }
  });

  // Resume consumer (nuovo evento)
  socket.on('resumeConsumer', async () => {
    console.log(`▶️ Resume consumer richiesto da ${socket.id}`);
    try {
      if (consumer) {
        await consumer.resume();
      }
    } catch (error) {
      console.error(`❌ Errore resume consumer per ${socket.id}:`, error);
    }
  });

  // Disconnessione
  socket.on('disconnect', (reason) => {
    console.log(`🔌 Client disconnesso: ${socket.id} - ${reason}`);
    
    // Chiudi i transport se questo socket era il producer
    if (producerTransport) {
      producerTransport.close();
      producerTransport = null;
    }
    if (producer) {
      producer.close();
      producer = null;
    }
  });

  // Gestione errori socket
  socket.on('error', (error) => {
    console.error(`❌ Errore socket ${socket.id}:`, error);
  });
});

async function createWebRtcTransport(socketId, callback) {
  try {
    // Configurazione IP - CRITICO per Render
    const announcedIp = process.env.RENDER_EXTERNAL_HOSTNAME || 
                       process.env.ANNOUNCED_IP || 
                       '127.0.0.1';
    
    console.log(`🌐 Configurato announcedIp: ${announcedIp} per ${socketId}`);

    const webRtcTransport_options = {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: announcedIp
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000
    };

    const transport = await router.createWebRtcTransport(webRtcTransport_options);
    console.log(`🚀 Transport creato per ${socketId}:`, transport.id);

    transport.on('dtlsstatechange', (dtlsState) => {
      console.log(`🔐 DTLS state change per ${socketId}: ${dtlsState}`);
      if (dtlsState === 'closed') {
        transport.close();
      }
    });

    transport.on('icegatheringstatechange', (iceGatheringState) => {
      console.log(`🧊 ICE gathering state per ${socketId}: ${iceGatheringState}`);
    });

    transport.on('icestatechange', (iceState) => {
      console.log(`🧊 ICE state change per ${socketId}: ${iceState}`);
    });

    transport.on('close', () => {
      console.log(`🚪 Transport chiuso per ${socketId}`);
    });

    // Invia i parametri al client
    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      }
    });

    return transport;
  } catch (error) {
    console.error(`❌ Errore creazione transport per ${socketId}:`, error);
    callback({ error: error.message });
    throw error;
  }
}

// Gestione errori globali del server
server.on('error', (error) => {
  console.error('❌ Errore server:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`🎉 Server in ascolto sulla porta ${port}`);
  console.log(`🌐 URL: http://0.0.0.0:${port}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🏷️  Announced IP: ${process.env.RENDER_EXTERNAL_HOSTNAME || process.env.ANNOUNCED_IP || '127.0.0.1'}`);
});
