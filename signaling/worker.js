const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      host: null,
      hostId: null,
      hostName: null,
      clients: new Map()
    });
  }
  return rooms.get(code);
}

function sendJson(socket, payload) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // no-op
  }
}

function forwardTo(room, targetId, payload) {
  if (room.hostId === targetId && room.host) {
    sendJson(room.host, payload);
    return true;
  }
  const client = room.clients.get(targetId);
  if (client) {
    sendJson(client, payload);
    return true;
  }
  return false;
}

async function handleSocket(server) {
  const clientId = crypto.randomUUID();
  let role = 'client';
  let code = null;
  let name = 'Guest';

  server.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === 'register') {
      role = message.role === 'host' ? 'host' : 'client';
      code = message.code;
      name = message.name || 'Guest';
      if (!code) {
        sendJson(server, { type: 'error', message: 'Missing invite code' });
        return;
      }
      const room = getRoom(code);
      if (role === 'host') {
        room.host = server;
        room.hostId = clientId;
        room.hostName = name;
        sendJson(server, { type: 'registered', clientId, role });
      } else {
        room.clients.set(clientId, server);
        sendJson(server, { type: 'registered', clientId, role });
        if (room.host) {
          const requestId = crypto.randomUUID();
          sendJson(room.host, {
            type: 'join_request',
            requestId,
            peerId: clientId,
            name,
            code
          });
        } else {
          sendJson(server, { type: 'host_offline' });
        }
      }
      return;
    }

    if (!code) return;
    const room = getRoom(code);

    if (message.type === 'join_accept' && role === 'host') {
      forwardTo(room, message.targetId, {
        type: 'join_accepted',
        hostId: room.hostId,
        hostName: room.hostName,
        role: message.role || 'viewer'
      });
      return;
    }

    if (message.type === 'join_reject' && role === 'host') {
      forwardTo(room, message.targetId, { type: 'join_rejected' });
      return;
    }

    if (message.type === 'webrtc_offer' && role === 'host') {
      forwardTo(room, message.targetId, {
        type: 'webrtc_offer',
        fromId: room.hostId,
        fromName: room.hostName,
        offer: message.offer
      });
      return;
    }

    if (message.type === 'webrtc_answer' && role === 'client') {
      forwardTo(room, room.hostId, {
        type: 'webrtc_answer',
        fromId: clientId,
        answer: message.answer
      });
      return;
    }

    if (message.type === 'ice_candidate') {
      forwardTo(room, message.targetId, {
        type: 'ice_candidate',
        fromId: clientId,
        candidate: message.candidate
      });
    }
  });

  server.addEventListener('close', () => {
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId === clientId) {
      room.host = null;
      room.hostId = null;
      room.hostName = null;
      for (const client of room.clients.values()) {
        sendJson(client, { type: 'host_offline' });
      }
    } else {
      room.clients.delete(clientId);
    }
  });
}

export default {
  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Project Brain signaling server', { status: 200 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    handleSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
};
