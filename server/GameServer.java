import com.sun.net.httpserver.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

/**
 * Fight.IO — Java Backend Server
 * 
 * Endpoints:
 *   GET  /api/leaderboard         → Top 10 scores (JSON)
 *   POST /api/leaderboard         → Submit score { "name": "...", "score": N, "wave": N, "kills": N }
 *   GET  /api/stats               → Global stats (total games, avg score, etc.)
 *   GET  /*                       → Serves static game files
 * 
 * Run:
 *   cd server
 *   javac GameServer.java
 *   java GameServer
 *   → http://localhost:8080
 */
public class GameServer {

    private static final int PORT = 8080;
    private static final String GAME_ROOT = "."; // Serve files from project root (CWD is project root)
    private static final String QTABLE_FILE = "server/qtable.json"; // Q-table persistence file

    // In-memory leaderboard
    private static final CopyOnWriteArrayList<ScoreEntry> leaderboard = new CopyOnWriteArrayList<>();
    private static int totalGames = 0;

    // In-memory Q-table (shared across all clients)
    private static volatile String qTableJson = "{}";
    private static volatile String qStatsJson = "{\"epsilon\":0.25,\"updates\":0,\"wins\":0,\"losses\":0}";

    // ---- Score Entry ----
    static class ScoreEntry implements Comparable<ScoreEntry> {
        String name;
        int score;
        int wave;
        int kills;
        long timestamp;

        ScoreEntry(String name, int score, int wave, int kills) {
            this.name = name;
            this.score = score;
            this.wave = wave;
            this.kills = kills;
            this.timestamp = System.currentTimeMillis();
        }

        @Override
        public int compareTo(ScoreEntry o) {
            return Integer.compare(o.score, this.score); // descending
        }

        String toJson() {
            return String.format(
                "{\"name\":\"%s\",\"score\":%d,\"wave\":%d,\"kills\":%d,\"timestamp\":%d}",
                escapeJson(name), score, wave, kills, timestamp
            );
        }
    }

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        // API routes
        server.createContext("/api/leaderboard", GameServer::handleLeaderboard);
        server.createContext("/api/stats", GameServer::handleStats);
        server.createContext("/api/qtable", GameServer::handleQTable);

        // Static file serving (game files)
        server.createContext("/", GameServer::handleStatic);

        server.setExecutor(null);

        // Load Q-table from disk on startup
        loadQTableFromDisk();

        server.start();

        // Start WebSocket relay server for online co-op
        new Thread(new WebSocketRelay()).start();

        System.out.println("===========================================");
        System.out.println("  Fight.IO Java Server running!");
        System.out.println("  http://localhost:" + PORT);
        System.out.println("  WebSocket relay: ws://localhost:8081");
        System.out.println("  Q-table file: " + QTABLE_FILE);
        System.out.println("===========================================");
    }

    // ---- /api/qtable ----
    // GET  → returns { "q": {...}, "stats": { epsilon, updates, wins, losses } }
    // POST → receives same format, merges Q-tables, saves to disk
    private static void handleQTable(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);

        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        if ("GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            String json = "{\"q\":" + qTableJson + ",\"stats\":" + qStatsJson + "}";
            sendJson(exchange, 200, json);
            System.out.println("[QTable] Sent Q-table to client (" + qTableJson.length() + " bytes)");

        } else if ("POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            String body = new String(exchange.getRequestBody().readAllBytes());
            try {
                // Extract "q" and "stats" from the posted JSON
                int qStart = body.indexOf("\"q\":");
                int statsStart = body.indexOf("\"stats\":");
                if (qStart < 0 || statsStart < 0) {
                    sendJson(exchange, 400, "{\"error\":\"Missing q or stats\"}");
                    return;
                }

                // Parse the q object and stats object
                String clientQ = extractJsonObject(body, "q");
                String clientStats = extractJsonObject(body, "stats");

                if (clientQ != null && !clientQ.equals("{}")) {
                    // Merge: client Q-values win if they have more updates
                    qTableJson = mergeQTables(qTableJson, clientQ);
                }
                if (clientStats != null) {
                    qStatsJson = clientStats;
                }

                // Persist to disk
                saveQTableToDisk();

                String response = "{\"status\":\"ok\",\"serverStates\":" + countKeys(qTableJson) + "}";
                sendJson(exchange, 200, response);
                System.out.println("[QTable] Received & merged Q-table from client (" + clientQ.length() + " bytes, " + countKeys(qTableJson) + " states)");

            } catch (Exception e) {
                e.printStackTrace();
                sendJson(exchange, 500, "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
            }
        } else {
            exchange.sendResponseHeaders(405, -1);
        }
    }

    // Merge two Q-table JSON objects — take the max absolute value for each state-action pair
    private static String mergeQTables(String serverJson, String clientJson) {
        // Simple merge: for each key in client, if |client value| > |server value|, use client
        // We'll do a character-level parse since we don't have a JSON library
        Map<String, Map<String, Double>> server = parseQTable(serverJson);
        Map<String, Map<String, Double>> client = parseQTable(clientJson);

        for (Map.Entry<String, Map<String, Double>> entry : client.entrySet()) {
            String state = entry.getKey();
            Map<String, Double> clientActions = entry.getValue();
            Map<String, Double> serverActions = server.getOrDefault(state, new HashMap<>());

            for (Map.Entry<String, Double> ae : clientActions.entrySet()) {
                String action = ae.getKey();
                double clientVal = ae.getValue();
                double serverVal = serverActions.getOrDefault(action, 0.0);

                // Keep the value with more learning (higher absolute value)
                if (Math.abs(clientVal) > Math.abs(serverVal) || !serverActions.containsKey(action)) {
                    serverActions.put(action, clientVal);
                }
            }
            server.put(state, serverActions);
        }

        return qTableToJson(server);
    }

    // Parse Q-table JSON into Map<state, Map<action, value>>
    private static Map<String, Map<String, Double>> parseQTable(String json) {
        Map<String, Map<String, Double>> result = new LinkedHashMap<>();
        if (json == null || json.equals("{}")) return result;

        // Remove outer braces
        String inner = json.trim();
        if (inner.startsWith("{")) inner = inner.substring(1);
        if (inner.endsWith("}")) inner = inner.substring(0, inner.length() - 1);
        inner = inner.trim();
        if (inner.isEmpty()) return result;

        // Parse state keys and their action objects
        int i = 0;
        while (i < inner.length()) {
            // Find state key
            int keyStart = inner.indexOf('"', i);
            if (keyStart < 0) break;
            int keyEnd = inner.indexOf('"', keyStart + 1);
            if (keyEnd < 0) break;
            String stateKey = inner.substring(keyStart + 1, keyEnd);

            // Find the opening brace of the value object
            int objStart = inner.indexOf('{', keyEnd);
            if (objStart < 0) break;
            int objEnd = inner.indexOf('}', objStart);
            if (objEnd < 0) break;

            String actionObj = inner.substring(objStart + 1, objEnd).trim();
            Map<String, Double> actions = new HashMap<>();

            if (!actionObj.isEmpty()) {
                String[] pairs = actionObj.split(",");
                for (String pair : pairs) {
                    String[] kv = pair.split(":");
                    if (kv.length == 2) {
                        String ak = kv[0].trim().replace("\"", "");
                        try {
                            double av = Double.parseDouble(kv[1].trim());
                            actions.put(ak, av);
                        } catch (NumberFormatException ignored) {}
                    }
                }
            }

            result.put(stateKey, actions);
            i = objEnd + 1;
        }
        return result;
    }

    // Convert Q-table map back to JSON string
    private static String qTableToJson(Map<String, Map<String, Double>> table) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Map<String, Double>> entry : table.entrySet()) {
            if (!first) sb.append(",");
            first = false;
            sb.append("\"" + entry.getKey() + "\":{");
            boolean firstA = true;
            for (Map.Entry<String, Double> ae : entry.getValue().entrySet()) {
                if (!firstA) sb.append(",");
                firstA = false;
                sb.append("\"" + ae.getKey() + "\":" + String.format("%.6f", ae.getValue()));
            }
            sb.append("}");
        }
        sb.append("}");
        return sb.toString();
    }

    // Extract a JSON object value by key name
    private static String extractJsonObject(String json, String key) {
        String pattern = "\"" + key + "\":";
        int idx = json.indexOf(pattern);
        if (idx < 0) return null;
        int start = json.indexOf('{', idx + pattern.length());
        if (start < 0) return null;
        int depth = 0;
        for (int i = start; i < json.length(); i++) {
            if (json.charAt(i) == '{') depth++;
            else if (json.charAt(i) == '}') {
                depth--;
                if (depth == 0) return json.substring(start, i + 1);
            }
        }
        return null;
    }

    private static int countKeys(String json) {
        int count = 0;
        boolean inKey = false;
        int depth = 0;
        for (int i = 0; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '{') depth++;
            else if (c == '}') depth--;
            else if (c == '"' && depth == 1) {
                if (!inKey) { count++; inKey = true; }
                else inKey = false;
            }
        }
        return count / 1; // each key counted once
    }

    private static void loadQTableFromDisk() {
        try {
            Path path = Paths.get(QTABLE_FILE);
            if (Files.exists(path)) {
                String content = Files.readString(path);
                String q = extractJsonObject(content, "q");
                String stats = extractJsonObject(content, "stats");
                if (q != null) qTableJson = q;
                if (stats != null) qStatsJson = stats;
                System.out.println("[QTable] Loaded from disk: " + countKeys(qTableJson) + " states");
            } else {
                System.out.println("[QTable] No saved Q-table found, starting fresh");
            }
        } catch (Exception e) {
            System.out.println("[QTable] Error loading from disk: " + e.getMessage());
        }
    }

    private static void saveQTableToDisk() {
        try {
            String content = "{\"q\":" + qTableJson + ",\"stats\":" + qStatsJson + "}";
            Files.writeString(Paths.get(QTABLE_FILE), content);
        } catch (Exception e) {
            System.out.println("[QTable] Error saving to disk: " + e.getMessage());
        }
    }

    // ---- /api/leaderboard ----
    private static void handleLeaderboard(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);

        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        if ("GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            List<ScoreEntry> top10 = leaderboard.stream()
                    .sorted()
                    .limit(10)
                    .collect(Collectors.toList());

            String json = "[" + top10.stream()
                    .map(ScoreEntry::toJson)
                    .collect(Collectors.joining(",")) + "]";

            sendJson(exchange, 200, json);

        } else if ("POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            String body = new String(exchange.getRequestBody().readAllBytes());
            try {
                String name = extractJsonString(body, "name");
                int score = extractJsonInt(body, "score");
                int wave = extractJsonInt(body, "wave");
                int kills = extractJsonInt(body, "kills");

                if (name == null || name.isBlank()) name = "Anonimo";
                if (name.length() > 20) name = name.substring(0, 20);

                ScoreEntry entry = new ScoreEntry(name, score, wave, kills);
                leaderboard.add(entry);
                totalGames++;

                // Keep only top 100
                if (leaderboard.size() > 100) {
                    leaderboard.sort(null);
                    while (leaderboard.size() > 100) {
                        leaderboard.remove(leaderboard.size() - 1);
                    }
                }

                sendJson(exchange, 200, "{\"status\":\"ok\",\"rank\":" + getRank(entry) + "}");
            } catch (Exception e) {
                sendJson(exchange, 400, "{\"error\":\"Invalid data\"}");
            }
        } else {
            exchange.sendResponseHeaders(405, -1);
        }
    }

    // ---- /api/stats ----
    private static void handleStats(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);

        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        int avgScore = 0;
        int maxScore = 0;
        int maxWave = 0;
        int totalKills = 0;

        for (ScoreEntry e : leaderboard) {
            avgScore += e.score;
            if (e.score > maxScore) maxScore = e.score;
            if (e.wave > maxWave) maxWave = e.wave;
            totalKills += e.kills;
        }

        if (!leaderboard.isEmpty()) avgScore /= leaderboard.size();

        String json = String.format(
            "{\"totalGames\":%d,\"totalPlayers\":%d,\"avgScore\":%d,\"maxScore\":%d,\"maxWave\":%d,\"totalKills\":%d}",
            totalGames, leaderboard.size(), avgScore, maxScore, maxWave, totalKills
        );

        sendJson(exchange, 200, json);
    }

    // ---- Static file server ----
    private static void handleStatic(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        if (path.equals("/")) path = "/index.html";

        // Prevent directory traversal
        Path root = Paths.get(GAME_ROOT).toAbsolutePath().normalize();
        Path resolved = root.resolve(path.substring(1)).normalize();
        if (!resolved.startsWith(root)) {
            exchange.sendResponseHeaders(403, -1);
            return;
        }

        File file = resolved.toFile();
        if (!file.exists() || file.isDirectory()) {
            String notFound = "404 Not Found";
            exchange.sendResponseHeaders(404, notFound.length());
            exchange.getResponseBody().write(notFound.getBytes());
            exchange.getResponseBody().close();
            return;
        }

        String mime = getMimeType(file.getName());
        exchange.getResponseHeaders().set("Content-Type", mime);
        exchange.sendResponseHeaders(200, file.length());

        try (InputStream is = new FileInputStream(file);
             OutputStream os = exchange.getResponseBody()) {
            is.transferTo(os);
        }
    }

    // ---- Helpers ----
    private static void addCorsHeaders(HttpExchange exchange) {
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
    }

    private static void sendJson(HttpExchange exchange, int code, String json) throws IOException {
        byte[] bytes = json.getBytes();
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(code, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.getResponseBody().close();
    }

    private static int getRank(ScoreEntry target) {
        List<ScoreEntry> sorted = leaderboard.stream().sorted().collect(Collectors.toList());
        for (int i = 0; i < sorted.size(); i++) {
            if (sorted.get(i) == target) return i + 1;
        }
        return sorted.size();
    }

    private static String getMimeType(String filename) {
        String lower = filename.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".css"))  return "text/css";
        if (lower.endsWith(".js"))   return "application/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png"))  return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif"))  return "image/gif";
        if (lower.endsWith(".svg"))  return "image/svg+xml";
        if (lower.endsWith(".ico"))  return "image/x-icon";
        if (lower.endsWith(".txt"))  return "text/plain";
        if (lower.endsWith(".tmx") || lower.endsWith(".tsx")) return "application/xml";
        return "application/octet-stream";
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r");
    }

    // Simple JSON parsing helpers (no external libs needed)
    private static String extractJsonString(String json, String key) {
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

    private static int extractJsonInt(String json, String key) {
        String pattern = "\"" + key + "\"";
        int idx = json.indexOf(pattern);
        if (idx < 0) return 0;
        int colonIdx = json.indexOf(':', idx + pattern.length());
        if (colonIdx < 0) return 0;
        StringBuilder sb = new StringBuilder();
        for (int i = colonIdx + 1; i < json.length(); i++) {
            char c = json.charAt(i);
            if (Character.isDigit(c) || c == '-') sb.append(c);
            else if (sb.length() > 0) break;
        }
        return sb.length() > 0 ? Integer.parseInt(sb.toString()) : 0;
    }
}
