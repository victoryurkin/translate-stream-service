docker buildx build --platform linux/amd64 -t us-east4-docker.pkg.dev/translate-voice-392913/services/translate-stream-service:1.0.11 .
docker push us-east4-docker.pkg.dev/translate-voice-392913/services/translate-stream-service:1.0.11
# docker run -d -p 8000:8000 --name translate --env-file .env translate-stream-service
gcloud run services replace service.yaml --region us-east4 --platform managed