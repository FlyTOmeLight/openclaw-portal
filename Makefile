.PHONY: install build start dev pack

install:
	cd backend && npm install
	cd frontend && npm install

build:
	cd frontend && npm run build
	cd backend && npm run build

dev:
	cd backend && npm run dev &
	cd frontend && npm run dev

start: build
	cd backend && npm start

pack:
	@echo "Building portal tarballs for linux/arm64 (Kylin V10 target)..."
	bash ../offline-install-kylin/repack-portal.sh

pack-local:
	$(MAKE) build
	@# Local build only — node_modules from host OS, not suitable for Kylin deployment
	rm -rf /tmp/openclaw-portal-pack
	mkdir -p /tmp/openclaw-portal-pack
	cp -r backend/dist backend/package.json backend/package-lock.json /tmp/openclaw-portal-pack/
	cd /tmp/openclaw-portal-pack && npm install --omit=dev --ignore-scripts 2>/dev/null
	tar -czf ../offline-install-kylin/portal-backend.tar.gz -C /tmp/openclaw-portal-pack .
	rm -rf /tmp/openclaw-portal-pack
	tar -czf ../offline-install-kylin/portal-frontend.tar.gz -C frontend/dist .
