package com.freez.vaultlink

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import com.freez.vaultlink.TauriActivity

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
