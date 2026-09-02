package com.example.app;

import com.example.core.CoreUtil;
import com.example.data.Session;
import com.example.data.*;

// @tag app
public class App {
    private final Session session;

    public App(Session session) {
        this.session = session;
    }

    public String greeting(String name) {
        return CoreUtil.shout("hello " + name + " (" + session.id() + ")");
    }
}
