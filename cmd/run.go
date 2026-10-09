package cmd

import (
	"context"
	"io/fs"

	apiPkg "github.com/lugvitc/whats4linux/api"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/server"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/lugvitc/whats4linux/internal/webkit"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

func run(assets fs.FS) error {
	api := apiPkg.New()

	store.LoadSettings()
	defer store.CloseSettings()

	return wails.Run(&options.App{
		Title:  misc.APP_NAME,
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: server.NewAssetFileServer(),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup: func(ctx context.Context) {
			webkit.EnableMediaStreamPermissions()
			api.Startup(ctx)
		},
		OnDomReady: func(ctx context.Context) {
			webkit.EnableMediaStreamPermissions()
		},
		OnShutdown: api.Shutdown,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               misc.APP_ID,
			OnSecondInstanceLaunch: api.OnSecondInstanceLaunch,
		},
		Bind: []any{
			api,
		},
		Linux: &linux.Options{
			WindowIsTranslucent: false,
			// Software rendering avoids WebKitGTK GPU-process crashes across
			// mixed Mesa/NVIDIA/Wayland setups.
			WebviewGpuPolicy: linux.WebviewGpuPolicyNever,
			ProgramName:      APP_NAME,
		},
	})
}
