package com.example.data

import com.example.core.CoreUtil as Core

// Two top-level types in one file whose name matches neither — exercises the resolver's
// package-directory expansion (file name != type name). Also exercises the complexity scorer:
// a when expression, a nested trailing lambda, an Elvis operator, and try/catch/finally.

class UserRepo {
    fun label(id: String): String = Core.shout("user:$id")

    fun kind(id: String?): String {
        return when (id) {
            null -> "anonymous"
            "admin" -> "privileged"
            else -> "regular"
        }
    }

    fun describe(ids: List<String>): String {
        var summary = ""
        ids.forEach { id ->
            summary = summary + id
        }
        return summary
    }
}

class Session(private val userId: String?) {
    fun id(): String = userId ?: "unknown"

    fun load(): String {
        return try {
            fetch()
        } catch (e: IllegalStateException) {
            "error"
        } finally {
            cleanup()
        }
    }

    private fun fetch(): String = userId ?: "missing"

    private fun cleanup() {}
}
