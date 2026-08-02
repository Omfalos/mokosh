package greet

// Hello returns a greeting, falling back to a generic one for an empty name.
func Hello(name string) string {
	if name == "" {
		return "Hello, stranger!"
	}
	return "Hello, " + name + "!"
}

// Greeter formats greetings using a configurable prefix.
type Greeter struct {
	Prefix string
}

// Format returns the receiver's prefix concatenated with name.
func (g *Greeter) Format(name string) string {
	return g.Prefix + name
}