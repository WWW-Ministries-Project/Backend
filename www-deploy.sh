#!/bin/bash

cd /home/ubuntu/projects/Backend 
sudo docker-compose down 
sudo docker system prune --force 
sudo git checkout production 
sudo git pull origin production 
sudo docker build -t www_backend . 
sudo docker-compose up -d backend