package com.example.app

import com.example.core.CoreUtil
import static com.example.core.CoreUtil.shout

// @tag app
class Formatter {
    String banner(String text) {
        return shout(CoreUtil.shout(text))
    }
}
