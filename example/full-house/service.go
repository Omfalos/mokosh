package fullhouse

import "example/fullhouse/greet"

// @tag app
func Greet(name string) string {
	return greet.Hello(name)
}