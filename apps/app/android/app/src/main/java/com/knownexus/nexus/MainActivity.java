package com.knownexus.nexus;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins register before super.onCreate builds the bridge.
        registerPlugin(SafFolderPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(ArtifactDownloadPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
