package com.example.app

import com.example.data.User
import com.example.data.UserRepo

// @tag ui
class Screen(private val repo: UserRepo) {
    fun render(user: User): String = repo.label(user.id) + " / " + user.name
}
