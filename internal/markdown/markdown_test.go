package markdown

import (
	"testing"
)

func TestHTMLToPlainText(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "empty",
			input:    "",
			expected: "",
		},
		{
			name:     "plain text",
			input:    "Hello world",
			expected: "Hello world",
		},
		{
			name:     "single paragraph",
			input:    "<p>Hello world</p>",
			expected: "Hello world",
		},
		{
			name:     "multiple paragraphs",
			input:    "<p>Line 1</p><p>Line 2</p>",
			expected: "Line 1\nLine 2",
		},
		{
			name:     "br tags",
			input:    "<p>Line 1<br>Line 2<br/>Line 3</p>",
			expected: "Line 1\nLine 2\nLine 3",
		},
		{
			name:     "links and inline styles",
			input:    `<p>Check <a href="https://example.com" class="msg-link">https://example.com</a> <b>bold</b> and <i>italic</i></p>`,
			expected: "Check https://example.com bold and italic",
		},
		{
			name:     "html entities",
			input:    "<p>Fish &amp; Chips &lt;rocks&gt; &quot;quote&quot; &#39;single&#39;</p>",
			expected: `Fish & Chips <rocks> "quote" 'single'`,
		},
		{
			name:     "blockquote and list",
			input:    "<blockquote>quote text</blockquote><ul><li>item 1</li><li>item 2</li></ul>",
			expected: "quote text\nitem 1\nitem 2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := HTMLToPlainText(tt.input)
			if actual != tt.expected {
				t.Fatalf("expected %q, got %q", tt.expected, actual)
			}
		})
	}
}
