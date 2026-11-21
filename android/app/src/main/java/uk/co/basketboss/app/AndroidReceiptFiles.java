package uk.co.basketboss.app;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Deletes only camera files created in this app's own Pictures directory. */
final class AndroidReceiptFiles {
    interface Deleter {
        boolean delete(File file);
    }

    private AndroidReceiptFiles() {}

    static boolean clear(File directory) throws IOException {
        return clear(directory, File::delete);
    }

    static boolean clear(File directory, Deleter deleter) throws IOException {
        if (directory == null) return false;
        for (File part = directory.getAbsoluteFile(); part != null; part = part.getParentFile()) {
            if (part.getName().equals(".") || part.getName().equals("..")) return false;
        }
        File root = directory.getCanonicalFile();
        File parent = directory.getAbsoluteFile().getParentFile();
        if (parent == null) return false;
        // Resolve ancestor aliases, but never follow a replaced Pictures folder.
        File expectedRoot = new File(parent.getCanonicalFile(), directory.getName());
        if (!root.equals(expectedRoot)) return false;
        if (!directory.exists()) return true;
        if (!root.isDirectory()) return false;
        File[] entries = root.listFiles();
        if (entries == null) return false;
        List<File> photos = new ArrayList<>();
        for (File entry : entries) {
            String name = entry.getName();
            if (!name.startsWith("JPEG_") || !name.endsWith(".jpg")) continue;
            File canonical = entry.getCanonicalFile();
            // Validate the complete set first. Matching symlinks/directories
            // cannot redirect cleanup to a gallery or another app directory.
            if (!root.equals(canonical.getParentFile()) || !entry.equals(canonical) || !entry.isFile()) return false;
            photos.add(entry);
        }
        boolean ok = true;
        for (File photo : photos) {
            if (!directory.getCanonicalFile().equals(root) || !photo.getCanonicalFile().equals(photo) || !photo.isFile()) return false;
            if (!deleter.delete(photo) || photo.exists()) ok = false;
        }
        return ok;
    }
}
