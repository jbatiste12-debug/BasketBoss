package uk.co.basketboss.app;

import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;

@CapacitorPlugin(name = "BasketBossAndroid")
public class BasketBossAndroidPlugin extends Plugin {
    @PluginMethod
    public void clearReceiptPhotos(PluginCall call) {
        try {
            if (!AndroidReceiptFiles.clear(getContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES))) {
                call.reject("Temporary receipt photos could not be cleared.", "BB_NATIVE_CLEANUP");
                return;
            }
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (IOException | SecurityException error) {
            call.reject("Temporary receipt photos could not be cleared.", "BB_NATIVE_CLEANUP");
        }
    }
}
