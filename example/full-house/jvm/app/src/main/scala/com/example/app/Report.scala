package com.example.app

import com.example.data.{ User, UserRepo }

// @tag app
object Report {
  def render(repo: UserRepo, users: List[User]): String = {
    import scala.collection.mutable.ListBuffer
    val lines = ListBuffer.empty[String]
    users.foreach(u => lines += repo.label(u.id))
    lines.mkString("\n")
  }
}
