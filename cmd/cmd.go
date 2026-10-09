package cmd

import (
	"flag"
	"fmt"
	"io/fs"
	"runtime"
)

const APP_NAME = "whats4linux"

// BuildArgs contains build-time information passed to the application.
type BuildArgs struct {
	Version   string
	BuildType string
	Date      string
	Commit    string
}

func Execute(args []string, assets fs.FS, bArgs BuildArgs) error {
	fsFlags := flag.NewFlagSet(APP_NAME, flag.ContinueOnError)
	fsFlags.Usage = func() {
		fmt.Printf("Usage: %s [flags]\n\nAn unofficial WhatsApp client for Linux.\n\nFlags:\n", APP_NAME)
		fsFlags.PrintDefaults()
	}

	showHelp := fsFlags.Bool("help", false, "prints the help message")
	fsFlags.BoolVar(showHelp, "h", false, "prints the help message")
	showVersion := fsFlags.Bool("version", false, "prints installed version")
	fsFlags.BoolVar(showVersion, "v", false, "prints installed version")

	if len(args) > 1 {
		switch args[1] {
		case "version", "v":
			printVersion(bArgs)
			return nil
		case "help", "h":
			fsFlags.Usage()
			return nil
		}
	}

	if len(args) > 1 {
		if err := fsFlags.Parse(args[1:]); err != nil {
			return err
		}
	}

	if *showHelp {
		fsFlags.Usage()
		return nil
	}

	if *showVersion {
		printVersion(bArgs)
		return nil
	}

	return run(assets)
}

func printVersion(bArgs BuildArgs) {
	fmt.Printf("%s %s-%s (%s_%s)\n", APP_NAME, bArgs.Version, bArgs.BuildType, runtime.GOOS, runtime.GOARCH)
	if bArgs.Commit != "" && bArgs.Date != "" {
		fmt.Printf("Build: %s=%s\n", bArgs.Date, bArgs.Commit)
	}
}
