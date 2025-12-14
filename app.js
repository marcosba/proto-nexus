function app() {
    return {
        // Variables de estado
        newBlogUrl: '',
        blogs: [],
        posts: [],
        loading: false,
        errorMessage: '',
        successMessage: '',
        workerUrl: 'https://proto-nexus.marcosba.workers.dev',
        
        // Inicialización
        async init() {
            this.loadBlogsFromStorage();
            if (this.blogs.length > 0) {
                await this.loadAllFeeds();
            }
            
            // Auto-recargar cada 10 minutos
            setInterval(() => this.loadAllFeeds(), 10 * 60 * 1000);
        },
        
        // Cargar blogs desde localStorage
        loadBlogsFromStorage() {
            const saved = localStorage.getItem('protoNexus_blogs');
            if (saved) {
                this.blogs = JSON.parse(saved);
            }
        },
        
        // Guardar blogs en localStorage
        saveBlogs() {
            localStorage.setItem('protoNexus_blogs', JSON.stringify(this.blogs));
        },
        
        // Añadir un nuevo blog
        async addBlog() {
            if (!this.newBlogUrl.trim()) {
                this.showError('Por favor, introduce una URL');
                return;
            }
            
            this.loading = true;
            this.clearMessages();
            
            try {
                let blogUrl = this.newBlogUrl.trim();
                
                // Asegurar que la URL tenga protocolo
                if (!blogUrl.startsWith('http://') && !blogUrl.startsWith('https://')) {
                    blogUrl = 'https://' + blogUrl;
                }
                
                // Paso 1: Descubrir el feed RSS
                this.showSuccess('Buscando feed RSS...');
                const feedInfo = await this.discoverFeed(blogUrl);
                
                if (!feedInfo.found) {
                    this.showError(`No se pudo encontrar un feed RSS. Intenté: ${feedInfo.tried.join(', ')}`);
                    this.loading = false;
                    return;
                }
                
                // Paso 2: Obtener información del blog desde el feed
                this.showSuccess('Obteniendo información del blog...');
                const blogInfo = await this.getBlogInfo(feedInfo.url);
                
                if (!blogInfo) {
                    this.showError('No se pudo obtener información del feed');
                    this.loading = false;
                    return;
                }
                
                // Crear objeto del blog
                const blog = {
                    id: Date.now() + Math.random(),
                    url: blogUrl,
                    feedUrl: feedInfo.url,
                    title: blogInfo.title || this.extractDomain(blogUrl),
                    lastUpdated: new Date().toISOString()
                };
                
                // Verificar si ya existe
                if (this.blogs.some(b => b.feedUrl === blog.feedUrl)) {
                    this.showError('Este blog ya está en tu lista');
                    this.loading = false;
                    return;
                }
                
                // Añadir a la lista
                this.blogs.push(blog);
                this.saveBlogs();
                
                // Limpiar y mostrar éxito
                this.newBlogUrl = '';
                this.showSuccess(`¡Blog "${blog.title}" añadido correctamente!`);
                
                // Cargar posts del nuevo blog
                await this.loadFeed(blog.feedUrl);
                
            } catch (error) {
                console.error('Error añadiendo blog:', error);
                this.showError('Error al procesar el blog: ' + error.message);
            } finally {
                this.loading = false;
            }
        },
        
        // Método mejorado para descubrir feeds RSS
        async discoverFeed(blogUrl) {
            const commonFeeds = [
                '/feed',
                '/feeds/posts/default', // Blogger específico
                '/feed/rss',
                '/rss',
                '/rss.xml',
                '/atom.xml',
                '/index.xml',
                '/feed.xml',
                '/?feed=rss2',
                '/?feed=rss',
                '/feed/atom'
            ];
            
            // Primero intentar obtener la página y buscar links RSS en el HTML
            try {
                const response = await fetch(`${this.workerUrl}/?mode=html&url=${encodeURIComponent(blogUrl)}`);
                if (response.ok) {
                    const html = await response.text();
                    
                    // Buscar links RSS en el HTML
                    const rssLinks = this.findRssLinksInHtml(html, blogUrl);
                    if (rssLinks.length > 0) {
                        // Probar cada link encontrado
                        for (const link of rssLinks) {
                            if (await this.testFeedUrl(link)) {
                                return { found: true, url: link, tried: ['HTML discovery'] };
                            }
                        }
                    }
                }
            } catch (e) {
                console.log('No se pudo analizar HTML, continuando con métodos estándar');
            }
            
            // Si no se encuentra en HTML, probar las rutas comunes
            const tried = [];
            for (const feedPath of commonFeeds) {
                const feedUrl = blogUrl.replace(/\/$/, '') + feedPath;
                tried.push(feedPath);
                
                if (await this.testFeedUrl(feedUrl)) {
                    return { found: true, url: feedUrl, tried };
                }
            }
            
            return { found: false, tried };
        },
        
        // Buscar links RSS en el HTML
        findRssLinksInHtml(html, baseUrl) {
            const links = [];
            
            // Buscar <link> tags con type="application/rss+xml" o "application/atom+xml"
            const linkRegex = /<link[^>]+(?:type=["'](?:application\/rss\+xml|application\/atom\+xml)["'][^>]+href=["']([^"']+)["']|href=["']([^"']+)["'][^>]+type=["'](?:application\/rss\+xml|application\/atom\+xml)["'])[^>]*>/gi;
            
            let match;
            while ((match = linkRegex.exec(html)) !== null) {
                const href = match[1] || match[2];
                if (href) {
                    const absoluteUrl = this.makeAbsoluteUrl(href, baseUrl);
                    links.push(absoluteUrl);
                }
            }
            
            // Buscar <a> tags que mencionen RSS
            const aRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(?:RSS|Feed|Atom|XML)[^<]*<\/a>/gi;
            while ((match = aRegex.exec(html)) !== null) {
                const href = match[1];
                const absoluteUrl = this.makeAbsoluteUrl(href, baseUrl);
                if (!links.includes(absoluteUrl)) {
                    links.push(absoluteUrl);
                }
            }
            
            return links;
        },
        
        // Convertir URL relativa a absoluta
        makeAbsoluteUrl(url, baseUrl) {
            if (url.startsWith('http://') || url.startsWith('https://')) {
                return url;
            }
            
            const base = new URL(baseUrl);
            if (url.startsWith('/')) {
                return `${base.origin}${url}`;
            } else {
                return `${base.origin}/${url}`;
            }
        },
        
        // Probar si una URL de feed es válida
        async testFeedUrl(feedUrl) {
            try {
                const response = await fetch(`${this.workerUrl}/?url=${encodeURIComponent(feedUrl)}&test=true`);
                if (response.ok) {
                    const contentType = response.headers.get('content-type');
                    if (contentType && (
                        contentType.includes('xml') || 
                        contentType.includes('rss') || 
                        contentType.includes('atom')
                    )) {
                        return true;
                    }
                    
                    // Leer un poco del contenido para ver si parece XML
                    const text = await response.text();
                    if (text.trim().startsWith('<?xml') || text.includes('<rss') || text.includes('<feed')) {
                        return true;
                    }
                }
                return false;
            } catch (error) {
                return false;
            }
        },
        
        // Obtener información del blog desde el feed
        async getBlogInfo(feedUrl) {
            try {
                const response = await fetch(`${this.workerUrl}/?url=${encodeURIComponent(feedUrl)}&mode=info`);
                if (response.ok) {
                    const data = await response.json();
                    return data;
                }
            } catch (error) {
                console.error('Error obteniendo info del feed:', error);
            }
            return null;
        },
        
        // Cargar un feed específico
        async loadFeed(feedUrl) {
            try {
                const response = await fetch(`${this.workerUrl}/?url=${encodeURIComponent(feedUrl)}`);
                if (!response.ok) throw new Error('Error del servidor');
                
                const data = await response.json();
                
                if (data.posts && data.posts.length > 0) {
                    const blog = this.blogs.find(b => b.feedUrl === feedUrl);
                    const blogTitle = blog ? blog.title : this.extractDomain(feedUrl);
                    
                    // Añadir posts al feed global
                    const newPosts = data.posts.map(post => ({
                        ...post,
                        id: post.link + post.date,
                        blogTitle: blogTitle,
                        blogUrl: blog ? blog.url : feedUrl
                    }));
                    
                    this.posts = [...newPosts, ...this.posts]
                        .filter((post, index, self) => 
                            index === self.findIndex(p => p.id === post.id)
                        )
                        .sort((a, b) => new Date(b.date) - new Date(a.date))
                        .slice(0, 100); // Limitar a 100 posts
                }
                
                return true;
            } catch (error) {
                console.error('Error cargando feed:', feedUrl, error);
                return false;
            }
        },
        
        // Cargar todos los feeds
        async loadAllFeeds() {
            if (this.blogs.length === 0) return;
            
            this.loading = true;
            this.clearMessages();
            
            try {
                const promises = this.blogs.map(blog => this.loadFeed(blog.feedUrl));
                await Promise.all(promises);
                
                this.showSuccess(`${this.posts.length} posts cargados`);
            } catch (error) {
                console.error('Error cargando feeds:', error);
                this.showError('Error cargando algunos feeds');
            } finally {
                this.loading = false;
            }
        },
        
        // Eliminar suscripción
        unsubscribe(blogId) {
            this.blogs = this.blogs.filter(b => b.id !== blogId);
            this.saveBlogs();
            
            // Filtrar posts de ese blog
            this.posts = this.posts.filter(p => {
                const blog = this.blogs.find(b => b.title === p.blogTitle);
                return blog !== undefined;
            });
            
            this.showSuccess('Blog eliminado');
        },
        
        // Funciones de utilidad
        extractDomain(url) {
            try {
                const domain = new URL(url).hostname;
                return domain.replace('www.', '');
            } catch {
                return url.replace(/^https?:\/\//, '').split('/')[0];
            }
        },
        
        formatDate(dateString) {
            try {
                const date = new Date(dateString);
                return date.toLocaleDateString('es-ES', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            } catch {
                return dateString || 'Fecha desconocida';
            }
        },
        
        showError(message) {
            this.errorMessage = message;
            this.successMessage = '';
            setTimeout(() => this.errorMessage = '', 5000);
        },
        
        showSuccess(message) {
            this.successMessage = message;
            this.errorMessage = '';
            setTimeout(() => this.successMessage = '', 5000);
        },
        
        clearMessages() {
            this.errorMessage = '';
            this.successMessage = '';
        },
        
        // Función para probar con blogs de ejemplo
        async testDefaultBlogs() {
            this.clearMessages();
            this.showSuccess('Añadiendo blogs de ejemplo...');
            
            const exampleBlogs = [
                'https://blogger.googleblog.com',
                'https://wordpress.com/blog',
                'https://news.ycombinator.com'
            ];
            
            for (const blogUrl of exampleBlogs) {
                this.newBlogUrl = blogUrl;
                await this.addBlog();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    };
}

// Inicializar la aplicación cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.appInstance = app();
    });
} else {
    window.appInstance = app();
}