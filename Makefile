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
	$(MAKE) build
	cd backend && tar -czf ../../offline-install-kylin/portal-backend.tar.gz dist package.json package-lock.json
	cd frontend && tar -czf ../../offline-install-kylin/portal-frontend.tar.gz dist
