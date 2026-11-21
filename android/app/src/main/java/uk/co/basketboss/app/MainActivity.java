package uk.co.basketboss.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BasketBossAndroidPlugin.class);
        registerPlugin(BasketBossGooglePlayPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
