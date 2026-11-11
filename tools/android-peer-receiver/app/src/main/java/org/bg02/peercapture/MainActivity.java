package org.bg02.peercapture;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;

/**
 * Experimental name-advertising, capture-only Android GATT server.
 *
 * This does NOT implement JieLi wallpaper sharing and will NOT download
 * images. Its purpose is to learn whether BG02 Send mode connects to a
 * candidate receiver, without purchasing a second badge. Never sends RCSP,
 * OTA or FitPro application commands and never records device addresses or
 * raw characteristic payload bytes.
 */
public final class MainActivity extends Activity {
    private static final int REQUEST_NEARBY = 801;
    private static final String DEFAULT_NAME = "wallpaper_adv";
    private static final long MAX_SESSION_MS = 120_000L;
    // Intentionally unique diagnostic UUIDs; NOT vendor/JieLi service claims.
    private static final UUID TEST_SERVICE = UUID.fromString("0b623fa4-b7fe-41f6-9fa4-54ec28f192d1");
    private static final UUID TEST_RX = UUID.fromString("0b623fa5-b7fe-41f6-9fa4-54ec28f192d1");
    private static final UUID TEST_TX = UUID.fromString("0b623fa6-b7fe-41f6-9fa4-54ec28f192d1");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayList<String> events = new ArrayList<>();
    private final byte[] identitySalt = new byte[16];
    private TextView statusView;
    private TextView eventView;
    private EditText nameField;
    private Button startButton;
    private Button stopButton;
    private BluetoothAdapter adapter;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothGattServer server;
    private AdvertiseCallback advertiseCallback;
    private String originalName;
    private String candidateName;
    private boolean nameModified;
    private boolean starting;
    private boolean running;
    private long startedAt;
    private int connections;
    private int writes;
    private int reads;
    private final Runnable autoStop = () -> {
        if (starting || running) {
            log("SESSION_LIMIT: stopping after two minutes");
            stopCapture();
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        new SecureRandom().nextBytes(identitySalt);
        startedAt = SystemClock.elapsedRealtime();
        setupView();
        log("OFFLINE. Nothing is broadcast until Start is tapped.");
        log("This is a diagnostic receiver, NOT a wallpaper file downloader.");
    }

    private void setupView() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(24, 20, 24, 20);

        TextView header = new TextView(this);
        header.setText("BG02 peer receiver — connection capture");
        header.setTextSize(20);
        layout.addView(header);

        TextView explanation = new TextView(this);
        explanation.setText("Advertise a receiver name and log whether the BG02 connects. No images are downloaded, no commands sent, and no raw addresses/payloads are saved. Starting temporarily changes this phone's Bluetooth name; Stop restores it.");
        layout.addView(explanation);

        statusView = new TextView(this);
        statusView.setText("Stopped / offline");
        statusView.setTextSize(16);
        layout.addView(statusView);

        nameField = new EditText(this);
        nameField.setSingleLine(true);
        nameField.setText(DEFAULT_NAME);
        nameField.setHint("Receiver advertising name");
        layout.addView(nameField);

        startButton = new Button(this);
        startButton.setText("START 120-SECOND CAPTURE");
        startButton.setOnClickListener(v -> startRequested());
        layout.addView(startButton);

        stopButton = new Button(this);
        stopButton.setText("STOP + RESTORE PHONE NAME");
        stopButton.setEnabled(false);
        stopButton.setOnClickListener(v -> stopCapture());
        layout.addView(stopButton);

        Button copy = new Button(this);
        copy.setText("COPY SANITIZED SUMMARY");
        copy.setOnClickListener(v -> copySummary());
        layout.addView(copy);

        eventView = new TextView(this);
        eventView.setTextIsSelectable(true);
        eventView.setTextSize(12);
        ScrollView scroller = new ScrollView(this);
        scroller.addView(eventView);
        layout.addView(scroller, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(layout);
    }

    private boolean permissionsOk() {
        if (Build.VERSION.SDK_INT < 31) return true;
        return checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
            && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private void startRequested() {
        if (running || starting) return;
        if (!permissionsOk()) {
            if (Build.VERSION.SDK_INT >= 31) {
                requestPermissions(new String[] {
                    Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT
                }, REQUEST_NEARBY);
            }
            return;
        }
        startCapture();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(requestCode, permissions, grants);
        if (requestCode == REQUEST_NEARBY) {
            if (permissionsOk()) startCapture();
            else log("Nearby devices permission declined. No BLE activity started.");
        }
    }

    @SuppressLint("MissingPermission")
    private void startCapture() {
        if (running || starting) return;
        String requested = nameField.getText().toString().trim();
        if (!requested.matches("[A-Za-z0-9_-]{3,20}")) {
            log("Invalid name: use 3-20 ASCII letters, digits, hyphen or underscore.");
            return;
        }
        BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        if (manager == null) { log("BluetoothManager unavailable"); return; }
        adapter = manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            log("Please enable Bluetooth in Android settings, then retry.");
            return;
        }
        if (!adapter.isMultipleAdvertisementSupported()) {
            log("This phone reports that BLE peripheral advertising is unsupported.");
            return;
        }
        advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser == null) { log("No BluetoothLeAdvertiser available"); return; }

        originalName = adapter.getName();
        if (originalName == null || originalName.isEmpty()) {
            log("Could not capture original Bluetooth name; refusing to rename the phone.");
            return;
        }
        candidateName = requested;
        startedAt = SystemClock.elapsedRealtime();
        connections = 0;
        writes = 0;
        reads = 0;
        starting = true;
        nameModified = false;
        startButton.setEnabled(false);
        stopButton.setEnabled(true);
        nameField.setEnabled(false);

        server = manager.openGattServer(this, gattCallback);
        if (server == null) {
            log("Could not create GATT server.");
            stopCapture();
            return;
        }

        // Benign test-only service, intentionally distinct from JieLi OTA/FitPro.
        BluetoothGattServiceCompat.addDiagnosticService(server);
        log("Opening capture-only GATT server. No vendor commands or image payloads supported.");
    }

    @SuppressLint("MissingPermission")
    private void beginAdvertise() {
        if (!starting || adapter == null || advertiser == null) return;
        if (!candidateName.equals(originalName)) {
            boolean changed = adapter.setName(candidateName);
            if (!changed) {
                log("Android refused Bluetooth name change. Stopping, not advertising wrong name.");
                stopCapture();
                return;
            }
            nameModified = true;
        }
        // Android name changes are asynchronous. Give the adapter time to publish it.
        handler.postDelayed(() -> {
            if (!starting || advertiser == null) return;
            AdvertiseSettings settings = new AdvertiseSettings.Builder()
                    .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                    .setConnectable(true)
                    .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                    .setTimeout(0)
                    .build();
            AdvertiseData data = new AdvertiseData.Builder()
                    .setIncludeDeviceName(true)
                    .build();
            advertiseCallback = new AdvertiseCallback() {
                @Override public void onStartSuccess(AdvertiseSettings settings) {
                    runOnUiThread(() -> {
                        if (!starting) return;
                        starting = false;
                        running = true;
                        log("ADVERTISE_STARTED: name=" + candidateName);
                        statusView.setText("Advertising " + candidateName + " — select it on BG02 Send Picture");
                        handler.postDelayed(autoStop, MAX_SESSION_MS);
                    });
                }
                @Override public void onStartFailure(int errorCode) {
                    runOnUiThread(() -> {
                        log("ADVERTISE_FAILED: Android error=" + errorCode);
                        stopCapture();
                    });
                }
            };
            try {
                advertiser.startAdvertising(settings, data, advertiseCallback);
                log("Requested connectable LE advertisement with local name; awaiting success.");
            } catch (SecurityException | IllegalArgumentException exception) {
                log("Advertising rejected: " + exception.getClass().getSimpleName());
                stopCapture();
            }
        }, 650);
    }

    private final BluetoothGattServerCallback gattCallback = new BluetoothGattServerCallback() {
        @Override public void onServiceAdded(int status, android.bluetooth.BluetoothGattService service) {
            runOnUiThread(() -> {
                if (!starting) return;
                log("GATT_SERVICE_READY: status=" + status + " (diagnostic only)");
                if (status == BluetoothGatt.GATT_SUCCESS) beginAdvertise();
                else stopCapture();
            });
        }

        @Override public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            String id = peerId(device);
            runOnUiThread(() -> {
                if (newState == BluetoothProfile.STATE_CONNECTED) connections++;
                log("GATT_LINK: peer=" + id + " state=" +
                    (newState == BluetoothProfile.STATE_CONNECTED ? "CONNECTED" :
                    newState == BluetoothProfile.STATE_DISCONNECTED ? "DISCONNECTED" : newState)
                    + " status=" + status);
            });
        }

        @Override public void onMtuChanged(BluetoothDevice device, int mtu) {
            log("GATT_MTU: peer=" + peerId(device) + " mtu=" + mtu);
        }

        @Override public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset,
                BluetoothGattCharacteristic characteristic) {
            log("GATT_READ: peer=" + peerId(device) + " uuid=" + characteristic.getUuid() + " offset=" + offset);
            runOnUiThread(() -> reads++);
            reply(device, requestId, offset == 0 ? BluetoothGatt.GATT_SUCCESS :
                    BluetoothGatt.GATT_INVALID_OFFSET, offset, new byte[0]);
        }

        @Override public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId,
                BluetoothGattCharacteristic characteristic, boolean preparedWrite,
                boolean responseNeeded, int offset, byte[] value) {
            log("GATT_WRITE: peer=" + peerId(device) + " uuid=" + characteristic.getUuid()
                    + " length=" + (value == null ? 0 : value.length)
                    + " prepared=" + preparedWrite + " offset=" + offset);
            runOnUiThread(() -> writes++);
            if (responseNeeded) reply(device, requestId,
                    preparedWrite ? BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED : BluetoothGatt.GATT_SUCCESS,
                    offset, null);
            // Intentionally DISCARD bytes; no file capture or protocol reply.
        }

        @Override public void onDescriptorReadRequest(BluetoothDevice device, int requestId,
                int offset, BluetoothGattDescriptor descriptor) {
            log("GATT_DESCRIPTOR_READ: uuid=" + descriptor.getUuid());
            reply(device, requestId, offset == 0 ? BluetoothGatt.GATT_SUCCESS :
                    BluetoothGatt.GATT_INVALID_OFFSET, offset, new byte[] {0, 0});
        }

        @Override public void onDescriptorWriteRequest(BluetoothDevice device, int requestId,
                BluetoothGattDescriptor descriptor, boolean preparedWrite,
                boolean responseNeeded, int offset, byte[] value) {
            log("GATT_DESCRIPTOR_WRITE: uuid=" + descriptor.getUuid() + " length=" +
                    (value == null ? 0 : value.length));
            if (responseNeeded) reply(device, requestId,
                    preparedWrite ? BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED : BluetoothGatt.GATT_SUCCESS,
                    offset, null);
        }

        @Override public void onExecuteWrite(BluetoothDevice device, int requestId, boolean execute) {
            log("GATT_PREPARED_WRITE_REJECTED");
            reply(device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null);
        }
    };

    @SuppressLint("MissingPermission")
    private void reply(BluetoothDevice device, int requestId, int status, int offset, byte[] bytes) {
        try {
            if (server != null) server.sendResponse(device, requestId, status, offset, bytes);
        } catch (Exception ex) {
            log("GATT_RESPONSE_ERROR: " + ex.getClass().getSimpleName());
        }
    }

    @SuppressLint("MissingPermission")
    private String peerId(BluetoothDevice device) {
        if (device == null) return "unknown";
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(identitySalt);
            byte[] hashed = digest.digest(device.getAddress().getBytes(StandardCharsets.US_ASCII));
            return String.format(Locale.ROOT, "%02x%02x%02x%02x", hashed[0], hashed[1], hashed[2], hashed[3]);
        } catch (Exception ex) {
            return "redacted";
        }
    }

    @SuppressLint("MissingPermission")
    private void stopCapture() {
        handler.removeCallbacks(autoStop);
        starting = false;
        running = false;
        if (advertiser != null && advertiseCallback != null) {
            try { advertiser.stopAdvertising(advertiseCallback); }
            catch (Exception ex) { log("Advertiser stop: " + ex.getClass().getSimpleName()); }
        }
        advertiseCallback = null;
        if (server != null) {
            try { server.close(); }
            catch (Exception ex) { log("GATT server close: " + ex.getClass().getSimpleName()); }
        }
        server = null;
        if (nameModified && adapter != null && originalName != null) {
            try {
                boolean ok = adapter.setName(originalName);
                log("RESTORE_BLUETOOTH_NAME: " + (ok ? "requested" : "failed — restore manually in Android Bluetooth Settings"));
            } catch (Exception ex) {
                log("RESTORE_BLUETOOTH_NAME: failed — restore manually in Android Bluetooth Settings");
            }
        }
        nameModified = false;
        statusView.setText("Stopped. Connections=" + connections + " writes=" + writes + " reads=" + reads);
        startButton.setEnabled(true);
        stopButton.setEnabled(false);
        nameField.setEnabled(true);
    }

    private void copySummary() {
        String summary = "BG02_PEER_CAPTURE_V1\n"
                + "Connects=" + connections + " characteristic_writes=" + writes + " reads=" + reads + "\n"
                + "Diagnostic receiver; not a file download.\n"
                + String.join("\n", events);
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("BG02 sanitized peer capture", summary));
            Toast.makeText(this, "Summary copied (no raw MACs/payload bytes)", Toast.LENGTH_LONG).show();
        }
    }

    private void log(String message) {
        runOnUiThread(() -> {
            long elapsed = (SystemClock.elapsedRealtime() - startedAt) / 1000;
            String entry = String.format(Locale.ROOT, "+%ds %s", elapsed, message);
            events.add(entry);
            if (events.size() > 350) events.remove(0);
            eventView.setText(String.join("\n", events));
        });
    }

    @Override protected void onDestroy() {
        stopCapture();
        super.onDestroy();
    }

    /** Single benign custom service to make GATT discovery measurable. */
    private static final class BluetoothGattServiceCompat {
        @SuppressLint("MissingPermission")
        static void addDiagnosticService(BluetoothGattServer gatt) {
            android.bluetooth.BluetoothGattService service = new android.bluetooth.BluetoothGattService(
                    TEST_SERVICE, android.bluetooth.BluetoothGattService.SERVICE_TYPE_PRIMARY);
            BluetoothGattCharacteristic rx = new BluetoothGattCharacteristic(
                    TEST_RX,
                    BluetoothGattCharacteristic.PROPERTY_READ
                            | BluetoothGattCharacteristic.PROPERTY_WRITE
                            | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                    BluetoothGattCharacteristic.PERMISSION_READ | BluetoothGattCharacteristic.PERMISSION_WRITE);
            BluetoothGattCharacteristic tx = new BluetoothGattCharacteristic(
                    TEST_TX,
                    BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                    BluetoothGattCharacteristic.PERMISSION_READ);
            tx.addDescriptor(new BluetoothGattDescriptor(CCCD,
                    BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
            service.addCharacteristic(rx);
            service.addCharacteristic(tx);
            gatt.addService(service);
        }
    }
}
