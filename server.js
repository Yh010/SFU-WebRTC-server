const fs = require('fs');
const https = require('https');
const express = require('express');
const socketIO = require('socket.io');
const mediasoup = require('mediasoup');
const config = require('./config');
const http = require('http');

const app = express();
// const server = https.createServer({
//   key: fs.readFileSync(config.sslKey),
//   cert: fs.readFileSync(config.sslCrt),
// }, app);
const server = http.createServer(app); 

const io = socketIO(server, { path: '/server' });

let worker, router, producerTransport, consumerTransport, producer, consumer;

// Start Mediasoup Worker
(async () => {
  worker = await mediasoup.createWorker(config.mediasoup.worker);
  router = await worker.createRouter({ mediaCodecs: config.mediasoup.router.mediaCodecs });

  console.log('Mediasoup worker created');
})();

// Socket.IO Signaling
io.on('connection', (socket) => {
  console.log('Client connected');

    socket.on('getRouterRtpCapabilities', (callback) => {
    if (typeof callback === 'function') {
        callback(router.rtpCapabilities);
    } else {
        console.error('Callback is not a function');
    }
    });

  socket.on('createProducerTransport', async (callback) => {
    const { transport, params } = await createTransport();
    producerTransport = transport;
    callback(params);
  });

  socket.on('connectProducerTransport', async ({ dtlsParameters }, callback) => {
    await producerTransport.connect({ dtlsParameters });
    callback();
  });

  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    producer = await producerTransport.produce({ kind, rtpParameters });
    callback({ id: producer.id });
  });

  socket.on('createConsumerTransport', async (callback) => {
    const { transport, params } = await createTransport();
    consumerTransport = transport;
    callback(params);
  });

  socket.on('connectConsumerTransport', async ({ dtlsParameters }, callback) => {
    await consumerTransport.connect({ dtlsParameters });
    callback();
  });

  socket.on('consume', async ({ rtpCapabilities }, callback) => {
    if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
      return callback({ error: 'Cannot consume' });
    }
    consumer = await consumerTransport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true,
    });
    callback({
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  });

  socket.on('resume', async (callback) => {
    await consumer.resume();
    callback();
  });
});

// Utility: Create WebRTC Transport
async function createTransport() {
  const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);
  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}

// Start server
server.listen(config.listenPort, () => {
  console.log(`Server is running at https://localhost:${config.listenPort}`);
});
