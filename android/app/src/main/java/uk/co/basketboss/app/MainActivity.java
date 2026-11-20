package uk.co.basketboss.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BasketBossAndroidPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
