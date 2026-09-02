package com.example.data

import com.example.core.CoreUtil as Core

// Two top-level types in one file whose name matches neither — exercises the resolver's
// package-directory expansion (file name != type name).

class UserRepo {
    fun label(id: String): String = Core.shout("user:$id")
}

class Session(private val userId: String) {
    fun id(): String = userId
}
