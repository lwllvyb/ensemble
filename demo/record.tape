# Ensemble demo — Codex + Claude reviewing code together
# Usage: cd ensemble && vhs demo/record.tape
# Output: demo/ensemble-demo.gif

Output demo/ensemble-demo.gif

Set Shell "zsh"
Set FontSize 15
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20
Set CursorBlink false

# Run the self-contained demo script
# It handles everything: shows code, launches collab, polls messages
Type "./demo/record-demo.sh"
Enter

# Wait for the full demo to complete (agents need time)
# Adjust this if your session takes longer
Sleep 120s
