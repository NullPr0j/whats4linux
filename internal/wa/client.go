package wa

import (
	"context"

	"github.com/lugvitc/whats4linux/internal/settings"
	_ "github.com/mattn/go-sqlite3"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/store/sqlstore"
	waLog "github.com/polymorfa/hypermeow/util/log"
)

func NewClient(ctx context.Context, container *sqlstore.Container) *whatsmeow.Client {
	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		panic(err)
	}
	clientLog := waLog.Stdout("Client", settings.GetLogLevel(), true)
	cli := whatsmeow.NewClient(deviceStore, clientLog)
	// Without this, a full app state sync applies patches but dispatches NO
	// events (whatsmeow drops them unless the flag is set), so archive/pin/
	// mute state synced from the phone would never reach our handlers.
	cli.EmitAppStateEventsOnFullSync = true
	return cli
}
