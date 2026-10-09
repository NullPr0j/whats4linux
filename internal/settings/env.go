package settings

import (
	"os"
	"strconv"
)

func (c *_settings) setupEnvVars() {
	if val, ok := os.LookupEnv("DEBUG"); ok {
		if b, err := strconv.ParseBool(val); err == nil {
			c.Debug = b
		}
	}
	if val, ok := os.LookupEnv("LOG_LEVEL"); ok {
		c.LogLevel = val
	}
}
