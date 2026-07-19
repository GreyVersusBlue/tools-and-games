{
  "npcs": [
    {
      "id": "guard",
      "name": "Guard",
      "role": "gatekeeper",
      "modelPath": null,
      "placeholder": {
        "color": "#8a2f2f",
        "heldProp": "ornate_medieval_mace_1k.gltf/ornate_medieval_mace_1k.gltf"
      },
      "position": [
        1.6,
        0,
        10.2
      ],
      "facing": 0,
      "patrol": null,
      "dialogue": {
        "default": [
          "Halt. None pass the gate without the Keystone.",
          "The old Scholar in the hall guards its secret behind one of his infernal riddles. Best of luck \u2014 I've never solved one."
        ],
        "hasKeystone": [
          "Well, I'll be. The Keystone itself.",
          "A deal's a deal. Stand back \u2014 this gate hasn't moved in years."
        ],
        "afterVictory": [
          "Go on then. The road's yours."
        ]
      }
    },
    {
      "id": "scholar",
      "name": "Scholar",
      "role": "riddler",
      "modelPath": null,
      "placeholder": {
        "color": "#2f4f8a",
        "heldProp": null
      },
      "position": [
        0.8,
        0,
        -9.6
      ],
      "facing": 200,
      "patrol": null,
      "dialogue": {
        "default": [
          "Ah, a visitor. You want the Keystone, no doubt. Everyone does.",
          "It is yours \u2014 if your wit is sharper than your sword. Answer me this\u2026",
          "{RIDDLE}"
        ],
        "hasKeystone": [
          "The Keystone suits you. Now go bother the Guard \u2014 he owes me three answers and a chicken."
        ],
        "afterVictory": [
          "The gate stands open. A mind well used is worth ten keys."
        ]
      }
    },
    {
      "id": "wizard",
      "name": "Wandering Wizard",
      "role": "atmosphere",
      "modelPath": null,
      "placeholder": {
        "color": "#5a2f8a",
        "heldProp": null
      },
      "position": [
        -6,
        0,
        2
      ],
      "facing": 90,
      "patrol": [
        [
          -6,
          0,
          2
        ],
        [
          -6,
          0,
          -3
        ],
        [
          -2,
          0,
          -4
        ],
        [
          -2,
          0,
          3
        ]
      ],
      "dialogue": {
        "default": [
          "Hmm? Oh, don't mind me. I'm counting the stones. There are more every time.",
          "The Scholar's riddles? Child's play. I simply choose not to answer them. On principle."
        ],
        "hasKeystone": [
          "You solved it? Fascinating. I was *this* close, you know."
        ],
        "afterVictory": [
          "An open gate is just a wall that gave up. Ponder that."
        ]
      }
    }
  ]
}