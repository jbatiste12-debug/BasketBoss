package uk.co.basketboss.app;

import static org.junit.Assert.*;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class AndroidReceiptFilesTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    private File picture(File directory, String name) throws Exception {
        File file = new File(directory, name);
        Files.write(file.toPath(), new byte[] {1, 2, 3});
        return file;
    }

    @Test public void deletesOnlyOwnedJpegCapturesAndSupportsDuplicateCleanup() throws Exception {
        File directory = temporary.newFolder("Pictures");
        File camera = picture(directory, "JPEG_20261120_170000_123.jpg");
        File other = picture(directory, "family.jpg");
        File png = picture(directory, "JPEG_20261120_1.png");
        File state = picture(directory, "saved-state.json");
        assertTrue(AndroidReceiptFiles.clear(directory));
        assertFalse(camera.exists());
        assertTrue(other.exists()); assertTrue(png.exists()); assertTrue(state.exists());
        assertTrue(AndroidReceiptFiles.clear(directory));
    }

    @Test public void missingDirectoryIsEmptyButUnavailableStorageAndRegularFilesFail() throws Exception {
        assertTrue(AndroidReceiptFiles.clear(new File(temporary.getRoot(), "absent")));
        assertFalse(AndroidReceiptFiles.clear(null));
        assertFalse(AndroidReceiptFiles.clear(temporary.newFile("not-directory")));
    }

    @Test public void matchingSymlinkOutsidePreventsCleanupAndPreservesBothLocations() throws Exception {
        File directory = temporary.newFolder("Pictures");
        File capture = picture(directory, "JPEG_good.jpg");
        File outside = temporary.newFile("gallery.jpg");
        Files.createSymbolicLink(new File(directory, "JPEG_escape.jpg").toPath(), outside.toPath());
        assertFalse(AndroidReceiptFiles.clear(directory));
        assertTrue(capture.exists()); assertTrue(outside.exists());
    }

    @Test public void replacedPicturesDirectoryCannotReachAnOutsideGallery() throws Exception {
        File gallery = temporary.newFolder("Gallery");
        File photo = picture(gallery, "JPEG_other.jpg");
        File appDirectory = temporary.newFolder("App");
        assertFalse(AndroidReceiptFiles.clear(new File(appDirectory, "../Gallery")));
        assertTrue(photo.exists());
        Path link = new File(temporary.getRoot(), "Pictures").toPath();
        Files.createSymbolicLink(link, gallery.toPath());
        assertFalse(AndroidReceiptFiles.clear(link.toFile()));
        assertTrue(photo.exists());
    }

    @Test public void directoriesAndFailedOrIncompleteDeletesNeverReturnSuccess() throws Exception {
        File directory = temporary.newFolder("Pictures");
        File photo = picture(directory, "JPEG_capture.jpg");
        assertFalse(AndroidReceiptFiles.clear(directory, file -> false));
        assertTrue(photo.exists());
        assertFalse(AndroidReceiptFiles.clear(directory, file -> true));
        assertTrue(photo.exists());
        File nested = new File(directory, "JPEG_folder.jpg"); assertTrue(nested.mkdir());
        assertFalse(AndroidReceiptFiles.clear(directory)); assertTrue(photo.exists()); assertTrue(nested.exists());
    }
}
