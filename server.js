const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: "*", // Permette connessioni da ovunque (il tuo index.html locale)
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
  worker = await mediasoup.createWorker({
    rtcMinPort: 10000, // Importante: Range porte UDP
    rtcMaxPort: 10100,
  });
  
  worker.on('died', () => {
    console.error('mediasoup worker died');
    process.exit(1);
  });

  console.log('Worker Mediasoup creato');

  router = await worker.createRouter({ mediaCodecs });
}

startMediasoup();

// Gestione Socket.io
io.on('connection', async (socket) => {
  console.log('Nuovo client connesso:', socket.id);

  // Invia le capacità RTP al client (necessario per iniziare)
  socket.emit('routerRtpCapabilities', router.rtpCapabilities);

  // Creazione del Transport (Canale di comunicazione)
  socket.on('createTransport', async ({ sender }, callback) => {
    if (sender) {
      producerTransport = await createWebRtcTransport(callback);
    } else {
      consumerTransport = await createWebRtcTransport(callback);
    }
  });

  // Connessione del Transport (DTLS)
  socket.on('connectTransport', async ({ dtlsParameters, sender }) => {
    if (sender) {
      await producerTransport.connect({ dtlsParameters });
    } else {
      await consumerTransport.connect({ dtlsParameters });
    }
  });

  // Broadcaster: Inizia a produrre video
  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    producer = await producerTransport.produce({ kind, rtpParameters });
    
    producer.on('transportclose', () => {
      console.log('Producer transport closed');
      producer.close();
    });

    console.log('Producer creato (ID):', producer.id);
    callback({ id: producer.id });
    
    // Avvisa tutti gli altri che c'è uno stream disponibile
    socket.broadcast.emit('newProducer', { producerId: producer.id });
  });

  // Viewer: Inizia a consumare video
  socket.on('consume', async ({ rtpCapabilities }, callback) => {
    try {
      if (!producer) {
        console.warn('Nessun producer attivo');
        return;
      }

      if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        console.warn('Impossibile consumare questo stream');
        return;
      }

      consumer = await consumerTransport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: true, // Si avvia in pausa, poi si riprende
      });

      consumer.on('transportclose', () => {
        console.log('Consumer transport closed');
      });

      consumer.on('producerclose', () => {
        console.log('Il producer ha chiuso lo stream');
        socket.emit('producerClosed');
        consumer.close();
      });

      // Rispondi al client con i parametri per vedere il video
      callback({
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      });

      // Avvia il video
      await consumer.resume();
      
    } catch (error) {
      console.error('Errore nel consumo:', error);
    }
  });
});

async function createWebRtcTransport(callback) {
  try {
    // ATTENZIONE: SU RENDER 'announcedIp' DEVE ESSERE L'IP PUBBLICO
    // In locale va bene '127.0.0.1', su server serve l'IP reale.
    const webRtcTransport_options = {
      listenIps: [
        {
          ip: '0.0.0.0', 
          announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1' // Cambia con l'IP pubblico del server Render se lo sai
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    const transport = await router.createWebRtcTransport(webRtcTransport_options);

    transport.on('dtlsstatechange', dtlsState => {
      if (dtlsState === 'closed') transport.close();
    });

    transport.on('close', () => {
      console.log('Transport closed');
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
    console.error(error);
  }
}

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
