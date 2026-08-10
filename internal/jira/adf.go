package jira

// Atlassian Document Format is a rich-text node tree. v3 takes worklog comments
// as one of these rather than the plain string v2 accepted, so a comment this
// app treats as a line of text has to be wrapped before it goes out.
type adfNode struct {
	Type    string    `json:"type"`
	Version int       `json:"version,omitempty"`
	Text    string    `json:"text,omitempty"`
	Content []adfNode `json:"content,omitempty"`
}

// adfParagraph wraps a plain string as the minimal valid ADF document: one
// paragraph holding one text node.
func adfParagraph(text string) adfNode {
	return adfNode{
		Type:    "doc",
		Version: 1,
		Content: []adfNode{{
			Type:    "paragraph",
			Content: []adfNode{{Type: "text", Text: text}},
		}},
	}
}

// adfEmptyDoc is the document that means "no comment". A PUT leaves omitted
// fields unchanged, so clearing a comment needs an explicit empty document
// rather than an absent field. ADF documents a paragraph's content as "zero or
// more nodes", which is what makes an empty paragraph legal here.
func adfEmptyDoc() adfNode {
	return adfNode{
		Type:    "doc",
		Version: 1,
		Content: []adfNode{{Type: "paragraph"}},
	}
}
