//go:build linux

package webkit

/*
#cgo linux pkg-config: gtk+-3.0 webkit2gtk-4.1
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

static gboolean on_permission_request(WebKitWebView *web_view, WebKitPermissionRequest *request, gpointer user_data) {
    if (WEBKIT_IS_USER_MEDIA_PERMISSION_REQUEST(request)) {
        webkit_permission_request_allow(request);
        return TRUE;
    }
    return FALSE;
}

static void setup_webview(GtkWidget *widget, gpointer data) {
    if (WEBKIT_IS_WEB_VIEW(widget)) {
        if (!g_object_get_data(G_OBJECT(widget), "whats4linux_configured")) {
            g_object_set_data(G_OBJECT(widget), "whats4linux_configured", GINT_TO_POINTER(1));
            WebKitSettings *settings = webkit_web_view_get_settings(WEBKIT_WEB_VIEW(widget));
            if (settings) {
                webkit_settings_set_enable_media_stream(settings, TRUE);
                webkit_settings_set_enable_webrtc(settings, TRUE);
            }
            g_signal_connect(widget, "permission-request", G_CALLBACK(on_permission_request), NULL);
        }
    } else if (GTK_IS_CONTAINER(widget)) {
        gtk_container_forall(GTK_CONTAINER(widget), (GtkCallback)setup_webview, data);
    }
}

static gboolean configure_all_webviews(gpointer user_data) {
    GList *toplevels = gtk_window_list_toplevels();
    for (GList *l = toplevels; l != NULL; l = l->next) {
        if (GTK_IS_CONTAINER(l->data)) {
            setup_webview(GTK_WIDGET(l->data), NULL);
        }
    }
    g_list_free(toplevels);
    return G_SOURCE_REMOVE;
}

void schedule_configure(void) {
    g_idle_add(configure_all_webviews, NULL);
}
*/
import "C"
import "time"

// EnableMediaStreamPermissions hooks into the GTK WebKitWebView and enables
// media streams (audio/video) and allows WebKitUserMediaPermissionRequest so
// navigator.mediaDevices.getUserMedia works in Wails on Linux.
func EnableMediaStreamPermissions() {
	C.schedule_configure()
	go func() {
		for i := 0; i < 6; i++ {
			time.Sleep(500 * time.Millisecond)
			C.schedule_configure()
		}
	}()
}
