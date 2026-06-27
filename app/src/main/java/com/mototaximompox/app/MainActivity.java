package com.mototaximompox.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {
    private static final String FALLBACK_API_BASE_URL = "http://10.0.2.2:4000";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String apiBaseUrl = FALLBACK_API_BASE_URL;
    private TextView statusText;
    private TextView apiUrlText;
    private Button checkButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(color("#F7F9FC"));

        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(color("#F7F9FC"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(28), dp(20), dp(28));
        scrollView.addView(root, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text("Mototaxi Mompox", 30, "#17202A", true);
        root.addView(title);

        TextView subtitle = text("App base conectada al backend local", 16, "#5D6D7E", false);
        subtitle.setPadding(0, dp(8), 0, dp(20));
        root.addView(subtitle);

        LinearLayout statusCard = new LinearLayout(this);
        statusCard.setOrientation(LinearLayout.VERTICAL);
        statusCard.setPadding(dp(18), dp(18), dp(18), dp(18));
        statusCard.setBackgroundResource(R.drawable.card_background);
        root.addView(statusCard, matchWrapParams(0, dp(16)));

        TextView statusLabel = text("Estado API", 14, "#5D6D7E", true);
        statusCard.addView(statusLabel);

        statusText = text("Sin probar", 20, "#17202A", true);
        statusText.setPadding(0, dp(6), 0, dp(10));
        statusCard.addView(statusText);

        apiUrlText = text(apiBaseUrl + "/api/health", 14, "#5D6D7E", false);
        statusCard.addView(apiUrlText);

        checkButton = primaryButton("Probar conexion");
        checkButton.setOnClickListener(v -> checkApi());
        root.addView(checkButton, matchWrapParams(0, dp(12)));

        Button clientButton = secondaryButton("Entrar como cliente");
        clientButton.setOnClickListener(v -> setStatus("Modulo cliente listo para conectar", "#146C5F"));
        root.addView(clientButton, matchWrapParams(0, dp(12)));

        Button driverButton = secondaryButton("Entrar como conductor");
        driverButton.setOnClickListener(v -> setStatus("Modulo conductor listo para conectar", "#146C5F"));
        root.addView(driverButton, matchWrapParams(0, dp(20)));

        TextView note = text("Tu telefono debe estar en la misma red Wi-Fi que el backend.", 14, "#5D6D7E", false);
        note.setGravity(Gravity.CENTER);
        root.addView(note);

        setContentView(scrollView);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void checkApi() {
        checkButton.setEnabled(false);
        setStatus("Buscando API...", "#5D6D7E");

        executor.execute(() -> {
            String foundBaseUrl = findApiBaseUrl();

            mainHandler.post(() -> {
                if (foundBaseUrl != null) {
                    apiBaseUrl = foundBaseUrl;
                    apiUrlText.setText(apiBaseUrl + "/api/health");
                    setStatus("API conectada", "#146C5F");
                } else {
                    setStatus("No se pudo conectar", "#B42318");
                }
                checkButton.setEnabled(true);
            });
        });
    }

    private String findApiBaseUrl() {
        for (String candidate : buildFixedApiCandidates()) {
            if (isApiHealthy(candidate, 900)) {
                return candidate;
            }
        }

        for (String prefix : getLocalNetworkPrefixes()) {
            String foundBaseUrl = scanNetworkPrefix(prefix);
            if (foundBaseUrl != null) {
                return foundBaseUrl;
            }
        }

        return null;
    }

    private List<String> buildFixedApiCandidates() {
        Set<String> candidates = new LinkedHashSet<>();
        candidates.add(apiBaseUrl);
        candidates.add(FALLBACK_API_BASE_URL);
        candidates.add("http://10.0.2.2:4000");

        return new ArrayList<>(candidates);
    }

    private String scanNetworkPrefix(String prefix) {
        ExecutorService scanner = Executors.newFixedThreadPool(32);
        CompletionService<String> completionService = new ExecutorCompletionService<>(scanner);
        int submitted = 0;

        try {
            for (int host = 1; host <= 254; host++) {
                String candidate = "http://" + prefix + "." + host + ":4000";
                completionService.submit(() -> isApiHealthy(candidate, 450) ? candidate : null);
                submitted++;
            }

            long deadline = System.currentTimeMillis() + 7000;
            for (int completed = 0; completed < submitted && System.currentTimeMillis() < deadline; completed++) {
                Future<String> future = completionService.poll(700, TimeUnit.MILLISECONDS);
                if (future == null) {
                    continue;
                }

                String foundBaseUrl = future.get();
                if (foundBaseUrl != null) {
                    return foundBaseUrl;
                }
            }
        } catch (Exception ignored) {
        } finally {
            scanner.shutdownNow();
        }

        return null;
    }

    private List<String> getLocalNetworkPrefixes() {
        Set<String> prefixes = new LinkedHashSet<>();

        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface networkInterface = interfaces.nextElement();
                if (!networkInterface.isUp() || networkInterface.isLoopback()) {
                    continue;
                }

                Enumeration<InetAddress> addresses = networkInterface.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        String hostAddress = address.getHostAddress();
                        int lastDot = hostAddress.lastIndexOf('.');
                        if (lastDot > 0) {
                            prefixes.add(hostAddress.substring(0, lastDot));
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }

        return new ArrayList<>(prefixes);
    }

    private boolean isApiHealthy(String baseUrl, int timeoutMs) {
        HttpURLConnection connection = null;

        try {
            URL url = new URL(baseUrl + "/api/health");
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
            connection.setRequestMethod("GET");

            int code = connection.getResponseCode();
            if (code != 200) {
                return false;
            }

            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
            StringBuilder body = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                body.append(line);
            }
            reader.close();

            return body.toString().contains("Mototaxi Mompox API");
        } catch (Exception error) {
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void setStatus(String message, String color) {
        statusText.setText(message);
        statusText.setTextColor(color(color));
    }

    private TextView text(String value, int sp, String color, boolean bold) {
        TextView textView = new TextView(this);
        textView.setText(value);
        textView.setTextSize(sp);
        textView.setTextColor(color(color));
        textView.setLineSpacing(0, 1.08f);
        if (bold) {
            textView.setTypeface(textView.getTypeface(), android.graphics.Typeface.BOLD);
        }
        return textView;
    }

    private Button primaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(15);
        button.setAllCaps(false);
        button.setBackgroundResource(R.drawable.button_primary);
        return button;
    }

    private Button secondaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(color("#17202A"));
        button.setTextSize(15);
        button.setAllCaps(false);
        button.setBackgroundResource(R.drawable.button_secondary);
        return button;
    }

    private LinearLayout.LayoutParams matchWrapParams(int top, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, top, 0, bottom);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private int color(String value) {
        return Color.parseColor(value);
    }
}
