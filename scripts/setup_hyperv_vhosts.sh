#!/bin/bash
# Script to symlink all vps_mirror directories to /home/ on Hyper-V
# and verify OpenLiteSpeed configuration

echo "Creating symlinks in /home from /home/vps_mirror..."
for d in /home/vps_mirror/*; do
  if [ -d "$d" ]; then
    name=$(basename "$d")
    if [ ! -e "/home/$name" ]; then
      ln -s "$d" "/home/$name"
      echo "Linked: /home/$name -> $d"
    fi
  fi
done

echo "Symlinks in /home:"
ls -lh /home/
