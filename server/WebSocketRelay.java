import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/**
 * WebSocket relay server for Fight.IO online co-op.
 * Supports up to 4 players per room.
 */
public class WebSocketRelay implements Runnable {

    private static final int WS_PORT = 8081;
    private static final String WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_PLAYERS = 4;

    private static final ConcurrentHashMap<String, GameRoom> rooms = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, ClientHandler> clients = new ConcurrentHashMap<>();

    // ---- Player info stored per-room ----
    static class PlayerInfo {
        String clientId;
        String color;
        String weapon;
        int slot; // 0 = host, 1-3 = guests

        PlayerInfo(String clientId, String color, String weapon, int slot) {
            this.clientId = clientId;
            this.color = color;
            this.weapon = weapon;
            this.slot = slot;
        }

        String toJson() {
            return "{\"id\":\"" + clientId + "\",\"color\":\"" + color +
                   "\",\"weapon\":\"" + weapon + "\",\"slot\":" + slot + "}";
        }
    }

    static class GameRoom {
        String code;
        String hostId;
        volatile boolean started = false;
        final List<PlayerInfo> players = new CopyOnWriteArrayList<>();
        final Set<String> readySet = ConcurrentHashMap.newKeySet();

        GameRoom(String code, String hostId) {
            this.code = code;
            this.hostId = hostId;
        }

        boolean isFull() { return players.size() >= MAX_PLAYERS; }

        PlayerInfo getPlayer(String clientId) {
            for (PlayerInfo p : players) if (p.clientId.equals(clientId)) return p;
            return null;
        }

        void removePlayer(String clientId) {
            players.removeIf(p -> p.clientId.equals(clientId));
        }

        String playersJson() {
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < players.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append(players.get(i).toJson());
            }
            sb.append("]");
            return sb.toString();
        }

        void broadcast(String msg) {
            for (PlayerInfo p : players) {
                ClientHandler ch = clients.get(p.clientId);
                if (ch != null) ch.sendMessage(msg);
            }
        }

        void broadcastExcept(String msg, String exceptId) {
            for (PlayerInfo p : players) {
                if (!p.clientId.equals(exceptId)) {
                    ClientHandler ch = clients.get(p.clientId);
                    if (ch != null) ch.sendMessage(msg);
                }
            }
        }
    }

    @Override
    public void run() {
        try {
            ServerSocket server = new ServerSocket(WS_PORT);
            System.out.println("  WebSocket relay on ws://localhost:" + WS_PORT + " (max " + MAX_PLAYERS + " players/room)");

            while (true) {
                Socket socket = server.accept();
                new Thread(new ClientHandler(socket)).start();
            }
        } catch (IOException e) {
            System.err.println("WebSocket server error: " + e.getMessage());
        }
    }

    static String generateRoomCode() {
        String chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder sb = new StringBuilder();
        Random rng = new Random();
        for (int i = 0; i < 4; i++) sb.append(chars.charAt(rng.nextInt(chars.length())));
        String code = sb.toString();
        while (rooms.containsKey(code)) {
            sb.setLength(0);
            for (int i = 0; i < 4; i++) sb.append(chars.charAt(rng.nextInt(chars.length())));
            code = sb.toString();
        }
        return code;
    }

    // ---- WebSocket Client Handler ----
    static class ClientHandler implements Runnable {
        Socket socket;
        InputStream in;
        OutputStream out;
        String clientId;
        String roomCode;
        volatile boolean connected = true;

        ClientHandler(Socket socket) {
            this.socket = socket;
            this.clientId = UUID.randomUUID().toString().substring(0, 8);
        }

        @Override
        public void run() {
            try {
                socket.setTcpNoDelay(true);
                socket.setSoTimeout(300000); // 5 minute timeout
                in = socket.getInputStream();
                out = socket.getOutputStream();

                if (!doHandshake()) { socket.close(); return; }

                clients.put(clientId, this);
                sendMessage("{\"type\":\"welcome\",\"id\":\"" + clientId + "\"}");

                while (connected) {
                    String msg = readFrame();
                    if (msg == null) break;
                    handleMessage(msg);
                }
            } catch (SocketTimeoutException e) {
                // timeout
            } catch (Exception e) {
                // connection lost
            } finally {
                disconnect();
            }
        }

        boolean doHandshake() throws IOException {
            BufferedReader reader = new BufferedReader(new InputStreamReader(in));
            Map<String, String> headers = new HashMap<>();
            String requestLine = reader.readLine();
            if (requestLine == null || !requestLine.contains("HTTP")) return false;

            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int colonIdx = line.indexOf(":");
                if (colonIdx > 0) {
                    headers.put(line.substring(0, colonIdx).trim().toLowerCase(),
                               line.substring(colonIdx + 1).trim());
                }
            }

            String wsKey = headers.get("sec-websocket-key");
            if (wsKey == null) return false;

            try {
                String accept = Base64.getEncoder().encodeToString(
                    MessageDigest.getInstance("SHA-1")
                        .digest((wsKey + WS_MAGIC).getBytes(StandardCharsets.UTF_8))
                );
                String response = "HTTP/1.1 101 Switching Protocols\r\n" +
                    "Upgrade: websocket\r\n" +
                    "Connection: Upgrade\r\n" +
                    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
                out.write(response.getBytes(StandardCharsets.UTF_8));
                out.flush();
                return true;
            } catch (Exception e) { return false; }
        }

        String readFrame() throws IOException {
            int b1 = in.read();
            if (b1 == -1) return null;
            int opcode = b1 & 0x0F;
            if (opcode == 0x8) return null;
            if (opcode == 0x9) {
                int b2 = in.read(); int len = b2 & 0x7F; boolean masked = (b2 & 0x80) != 0;
                byte[] payload = readPayload(len, masked);
                sendPong(payload);
                return readFrame();
            }
            if (opcode == 0xA) {
                int b2 = in.read(); int len = b2 & 0x7F; boolean masked = (b2 & 0x80) != 0;
                readPayload(len, masked);
                return readFrame();
            }
            int b2 = in.read();
            if (b2 == -1) return null;
            boolean masked = (b2 & 0x80) != 0;
            long payloadLen = b2 & 0x7F;
            if (payloadLen == 126) {
                int hi = in.read(), lo = in.read();
                if (hi == -1 || lo == -1) return null;
                payloadLen = (hi << 8) | lo;
            } else if (payloadLen == 127) {
                payloadLen = 0;
                for (int i = 0; i < 8; i++) {
                    int byteVal = in.read();
                    if (byteVal == -1) return null;
                    payloadLen = (payloadLen << 8) | byteVal;
                }
            }
            if (payloadLen > 1_000_000) return null;
            byte[] maskKey = null;
            if (masked) { maskKey = new byte[4]; if (in.read(maskKey) != 4) return null; }
            byte[] payload = new byte[(int) payloadLen];
            int totalRead = 0;
            while (totalRead < payloadLen) {
                int r = in.read(payload, totalRead, (int) payloadLen - totalRead);
                if (r == -1) return null;
                totalRead += r;
            }
            if (masked && maskKey != null) {
                for (int i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
            }
            return new String(payload, StandardCharsets.UTF_8);
        }

        byte[] readPayload(int len, boolean masked) throws IOException {
            long payloadLen = len;
            if (payloadLen == 126) payloadLen = (in.read() << 8) | in.read();
            else if (payloadLen == 127) { payloadLen = 0; for (int i = 0; i < 8; i++) payloadLen = (payloadLen << 8) | in.read(); }
            byte[] maskKey = null;
            if (masked) { maskKey = new byte[4]; in.read(maskKey); }
            byte[] data = new byte[(int) payloadLen];
            int read = 0;
            while (read < payloadLen) { int r = in.read(data, read, (int) payloadLen - read); if (r == -1) break; read += r; }
            if (masked && maskKey != null) { for (int i = 0; i < data.length; i++) data[i] ^= maskKey[i % 4]; }
            return data;
        }

        synchronized void sendMessage(String msg) {
            if (!connected) return;
            try {
                byte[] data = msg.getBytes(StandardCharsets.UTF_8);
                if (data.length < 126) { out.write(0x81); out.write(data.length); }
                else if (data.length < 65536) { out.write(0x81); out.write(126); out.write((data.length >> 8) & 0xFF); out.write(data.length & 0xFF); }
                else { out.write(0x81); out.write(127); for (int i = 7; i >= 0; i--) out.write((int) ((data.length >> (8 * i)) & 0xFF)); }
                out.write(data); out.flush();
            } catch (IOException e) { connected = false; }
        }

        void sendPong(byte[] payload) {
            try { out.write(0x8A); out.write(payload.length); out.write(payload); out.flush(); }
            catch (IOException e) { connected = false; }
        }

        void handleMessage(String msg) {
            try {
                String type = extractJsonString(msg, "type");
                if (type == null) return;

                switch (type) {
                    case "create_room": {
                        String color = extractJsonString(msg, "color");
                        String weapon = extractJsonString(msg, "weapon");
                        String code = generateRoomCode();
                        GameRoom room = new GameRoom(code, clientId);
                        PlayerInfo host = new PlayerInfo(clientId, color != null ? color : "green", weapon != null ? weapon : "weapon_sword", 0);
                        room.players.add(host);
                        rooms.put(code, room);
                        this.roomCode = code;
                        sendMessage("{\"type\":\"room_created\",\"code\":\"" + code + "\",\"players\":" + room.playersJson() + "}");
                        System.out.println("Room created: " + code + " by " + clientId);
                        break;
                    }
                    case "join_room": {
                        String code = extractJsonString(msg, "code");
                        String color = extractJsonString(msg, "color");
                        String weapon = extractJsonString(msg, "weapon");
                        if (code == null) { sendMessage("{\"type\":\"error\",\"msg\":\"No code\"}"); break; }
                        code = code.toUpperCase();
                        GameRoom room = rooms.get(code);
                        if (room == null) { sendMessage("{\"type\":\"error\",\"msg\":\"Sala no encontrada\"}"); break; }
                        if (room.isFull()) { sendMessage("{\"type\":\"error\",\"msg\":\"Sala llena (max " + MAX_PLAYERS + ")\"}"); break; }

                        int slot = room.players.size();
                        PlayerInfo pi = new PlayerInfo(clientId, color != null ? color : "purple", weapon != null ? weapon : "weapon_axe", slot);
                        room.players.add(pi);
                        this.roomCode = code;

                        // Update everyone with new player list
                        room.broadcast("{\"type\":\"player_list\",\"players\":" + room.playersJson() + "}");
                        System.out.println("Player " + clientId + " joined room " + code + " (slot " + slot + ", total " + room.players.size() + ")");
                        break;
                    }
                    case "start_game": {
                        if (roomCode == null) break;
                        GameRoom room = rooms.get(roomCode);
                        if (room == null || room.players.size() < 2) break;
                        room.started = true;
                        String startMsg = "{\"type\":\"game_start\",\"players\":" + room.playersJson() + ",\"hostId\":\"" + room.hostId + "\"}";
                        room.broadcast(startMsg);
                        System.out.println("Game started in room " + roomCode + " with " + room.players.size() + " players");
                        break;
                    }
                    case "restart_game": {
                        // Host requests restart — keep everyone in the room
                        if (roomCode == null) break;
                        GameRoom room = rooms.get(roomCode);
                        if (room == null) break;
                        room.started = true;
                        room.readySet.clear();
                        String restartMsg = "{\"type\":\"game_restart\",\"players\":" + room.playersJson() + ",\"hostId\":\"" + room.hostId + "\"}";
                        room.broadcast(restartMsg);
                        System.out.println("Game restarted in room " + roomCode);
                        break;
                    }
                    case "ready_restart": {
                        // Player votes ready for restart — restart when at least half are ready
                        if (roomCode == null) break;
                        GameRoom room = rooms.get(roomCode);
                        if (room == null) break;
                        room.readySet.add(clientId);
                        int needed = Math.max(1, (int) Math.ceil(room.players.size() / 2.0));
                        int ready = room.readySet.size();
                        // Notify everyone of ready count
                        room.broadcast("{\"type\":\"ready_count\",\"ready\":" + ready + ",\"needed\":" + needed + ",\"total\":" + room.players.size() + "}");
                        System.out.println("Ready restart: " + ready + "/" + needed + " in room " + roomCode);
                        if (ready >= needed) {
                            room.readySet.clear();
                            room.started = true;
                            String restartMsg = "{\"type\":\"game_restart\",\"players\":" + room.playersJson() + ",\"hostId\":\"" + room.hostId + "\"}";
                            room.broadcast(restartMsg);
                            System.out.println("Game restarted (vote) in room " + roomCode);
                        }
                        break;
                    }
                    case "state":
                    case "input":
                    case "sync": {
                        if (roomCode == null) break;
                        GameRoom room = rooms.get(roomCode);
                        if (room == null) break;
                        // Relay to all other players in the room
                        room.broadcastExcept(msg, clientId);
                        break;
                    }
                    case "ping": {
                        sendMessage("{\"type\":\"pong\"}");
                        break;
                    }
                    default:
                        break;
                }
            } catch (Exception e) {
                System.err.println("Error handling message: " + e.getMessage());
            }
        }

        void disconnect() {
            connected = false;
            clients.remove(clientId);

            if (roomCode != null) {
                GameRoom room = rooms.get(roomCode);
                if (room != null) {
                    room.removePlayer(clientId);

                    if (clientId.equals(room.hostId)) {
                        // Host left — if players remain, promote next to host
                        if (!room.players.isEmpty()) {
                            room.hostId = room.players.get(0).clientId;
                            room.players.get(0).slot = 0;
                            // Re-slot everyone
                            for (int i = 0; i < room.players.size(); i++) room.players.get(i).slot = i;
                            room.broadcast("{\"type\":\"player_left\",\"leftId\":\"" + clientId +
                                "\",\"newHostId\":\"" + room.hostId +
                                "\",\"players\":" + room.playersJson() + "}");
                        } else {
                            rooms.remove(roomCode);
                        }
                    } else {
                        // Guest left — notify remaining
                        // Re-slot
                        for (int i = 0; i < room.players.size(); i++) room.players.get(i).slot = i;
                        room.broadcast("{\"type\":\"player_left\",\"leftId\":\"" + clientId +
                            "\",\"players\":" + room.playersJson() + "}");
                        if (room.players.isEmpty()) rooms.remove(roomCode);
                    }
                }
            }

            try { socket.close(); } catch (IOException ignored) {}
            System.out.println("Client disconnected: " + clientId);
        }

        static String extractJsonString(String json, String key) {
            String pattern = "\"" + key + "\"";
            int idx = json.indexOf(pattern);
            if (idx < 0) return null;
            int colonIdx = json.indexOf(':', idx + pattern.length());
            if (colonIdx < 0) return null;
            int startQuote = json.indexOf('"', colonIdx + 1);
            if (startQuote < 0) return null;
            int endQuote = json.indexOf('"', startQuote + 1);
            if (endQuote < 0) return null;
            return json.substring(startQuote + 1, endQuote);
        }
    }
}
