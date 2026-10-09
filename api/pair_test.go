package api

import (
	"testing"
)

func TestSanitizePhoneNumber(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{
			name:    "valid US with +",
			input:   "+1 (650) 253-0000",
			want:    "16502530000",
			wantErr: false,
		},
		{
			name:    "valid US without +",
			input:   "16502530000",
			want:    "16502530000",
			wantErr: false,
		},
		{
			name:    "valid UK with formatting",
			input:   "+44 20 7183 8750",
			want:    "442071838750",
			wantErr: false,
		},
		{
			name:    "valid UK without +",
			input:   "44 20 7183 8750",
			want:    "442071838750",
			wantErr: false,
		},
		{
			name:    "valid India number",
			input:   "+91 98765 43210",
			want:    "919876543210",
			wantErr: false,
		},
		{
			name:    "empty string",
			input:   "",
			want:    "",
			wantErr: true,
		},
		{
			name:    "too short",
			input:   "123",
			want:    "",
			wantErr: true,
		},
		{
			name:    "starts with 0 in international format",
			input:   "+0123456789",
			want:    "",
			wantErr: true,
		},
		{
			name:    "invalid characters/letters",
			input:   "+1 (800) FLOWERS",
			want:    "",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := SanitizePhoneNumber(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("SanitizePhoneNumber(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("SanitizePhoneNumber(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
