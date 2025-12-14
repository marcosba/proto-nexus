function app() {
    return {
        // Estado de la aplicación
        newBlogUrl: '',
        blogs: [],
        posts: [],
        isLoading: false,
        isAddingBlog: false,
        message: '',
        messageType: '',
        
        // Inicialización
        async init() {
            console.log('Proto-Nexus iniciando...');
            
            // Cargar blogs guardados
            this.loadSavedBlogs();
            
            // Cargar posts si hay blogs
            if (this.blogs.length > 0) {
                await this.loadAllFeeds();
            }
            
            // Configurar recarga automática cada 15 minutos
            setInterval(() => {
                if (this.blogs.length > 0) {
                    this.loadAllFeeds();
                }
            }, 15 * 60 * 1000);
            
            console.log('Aplicación lista');
        },
        
        // Cargar blogs desde localStorage
        loadSavedBlogs() {
            try {
                const saved = localStorage.getItem('protoNexus_blogs');
                if (saved) {
                    this.blogs = JSON.parse(saved);
                    console.log(`Cargados ${this.blogs.length} blogs desde localStorage`);
                }
            } catch (error) {
                console.error('Error cargando blogs:', error);
                this.blogs = [];
            }
        },
        
        // Guardar blogs en localStorage
        saveBlogs() {
            try {
                localStorage.setItem('protoNexus_blogs', JSON.stringify(this.blogs));
            } catch (error) {
                console.error('Error guardando blogs:', error);
            }
        },
        
        // Añadir un nuevo blog
        async addBlog() {
            if (!this.newBlogUrl.trim()) {
                this.showMessage('Por favor, introduce una URL', 'error');
                return;
            }
            
            this.isAddingBlog = true;
            this.message = '';
            
            try {
                // Normalizar URL
                let blogUrl = this.newBlogUrl.trim();
                if (!blogUrl.startsWith('http')) {
                    blogUrl = 'https://' + blogUrl;
                }
                
                // Verificar si ya existe
                if (this.blogs.some(b => b.url === blogUrl)) {
                    this.showMessage('Este blog ya está en tu lista', 'error');
                    this.isAddingBlog = false;
                    return;
                }
                
                // Buscar feed RSS
                this.showMessage('Buscando feed RSS...', '');
                
                const feedInfo = await this.discoverFeed(blogUrl);
                
                if (!feedInfo || !feedInfo.feedUrl) {
                    this.showMessage('No se pudo encontrar un feed RSS en este blog. Intenta con la URL completa del feed si la conoces.', 'error');
                    this.isAddingBlog = false;
                    return;
                }
                
                // Crear objeto blog
                const blog = {
                    id: Date.now() + Math.random(),
                    url: blogUrl,
                    feedUrl: feedInfo.feedUrl,
                    title: feedInfo.title || this.extractDomain(blogUrl),
                    addedAt: new Date().toISOString()
                };
                
                // Añadir a la lista
                this.blogs.unshift(blog);
                this.saveBlogs();
                
                // Limpiar y mostrar éxito
                this.newBlogUrl = '';
                this.showMessage(`¡Blog añadido! Encontrado: ${feedInfo.title || 'Feed RSS'}`, 'success');
                
                // Cargar posts de este blog
                await this.loadFeed(blog);
                
            } catch (error) {
                console.error('Error añadiendo blog:', error);
                this.showMessage(`Error: ${error.message}`, 'error');
            } finally {
                this.isAddingBlog = false;
                
                // Auto-ocultar mensaje después de 5 segundos
                if (this.message) {
                    setTimeout(() => {
                        this.message = '';
                    }, 5000);
                }
            }
        },
        
        // Método MEJORADO para descubrir feeds RSS
        async discoverFeed(blogUrl) {
            console.log(`Buscando feed para: ${blogUrl}`);
            
            // Lista COMPLETA de posibles ubicaciones de feeds
            const possibleFeedPaths = [
                // Comunes
                '/feed',
                '/feeds/posts/default',  // Blogger estándar
                '/feeds/posts/default?alt=rss', // Blogger alternativo
                '/atom.xml',
                '/rss',
                '/rss.xml',
                '/rss2.xml',
                '/feed.xml',
                '/index.xml',
                // WordPress común
                '/feed/rss',
                '/feed/rss2',
                '/feed/atom',
                '/?feed=rss',
                '/?feed=rss2',
                '/?feed=atom',
                // Tumblr
                '/rss',
                // Medium (si permite)
                '/feed/',
                // Substack
                '/feed',
                // Específicos de plataformas
                '/blog/feed',
                '/posts/feed',
                '/news/feed',
                // Directorios alternativos
                '/feed/rss/',
                '/index.rss',
                '/.rss',
                // Sin barra inicial
                'feed',
                'rss',
                'atom.xml'
            ];
            
            // Primero intentar obtener la página y buscar links RSS en el HTML
            try {
                const pageResponse = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(blogUrl)}`);
                if (pageResponse.ok) {
                    const pageData = await pageResponse.json();
                    const html = pageData.contents;
                    
                    // Buscar enlaces RSS en el HTML (más efectivo)
                    const rssLinks = this.findRssLinksInHtml(html, blogUrl);
                    if (rssLinks.length > 0) {
                        console.log('Enlaces RSS encontrados en HTML:', rssLinks);
                        
                        // Probar cada enlace encontrado
                        for (const link of rssLinks) {
                            const isValid = await this.testFeedUrl(link);
                            if (isValid) {
                                const title = this.extractTitleFromHtml(html) || this.extractDomain(blogUrl);
                                return { feedUrl: link, title: title };
                            }
                        }
                    }
                    
                    // Si no encontramos en HTML, extraer título de la página
                    const pageTitle = this.extractTitleFromHtml(html) || this.extractDomain(blogUrl);
                    
                    // Probar paths comunes usando el dominio base
                    const baseUrl = blogUrl.replace(/\/$/, '');
                    const testedUrls = new Set();
                    
                    for (const path of possibleFeedPaths) {
                        let testUrl;
                        
                        if (path.startsWith('/') || path.startsWith('?')) {
                            testUrl = baseUrl + path;
                        } else if (path.includes('://')) {
                            testUrl = path;
                        } else {
                            testUrl = baseUrl + '/' + path;
                        }
                        
                        // Evitar probar la misma URL dos veces
                        if (testedUrls.has(testUrl)) continue;
                        testedUrls.add(testUrl);
                        
                        console.log(`Probando: ${testUrl}`);
                        
                        const isValid = await this.testFeedUrl(testUrl);
                        if (isValid) {
                            return { feedUrl: testUrl, title: pageTitle };
                        }
                        
                        // Pequeña pausa para no saturar
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
            } catch (error) {
                console.warn('Error analizando página:', error);
            }
            
            // Si todo falla, intentar con la API AllOrigins para feeds directos
            const directFeedUrl = `${blogUrl}/feed`;
            const isValidDirect = await this.testFeedUrl(directFeedUrl);
            if (isValidDirect) {
                return { feedUrl: directFeedUrl, title: this.extractDomain(blogUrl) };
            }
            
            return null;
        },
        
        // Buscar enlaces RSS en HTML
        findRssLinksInHtml(html, baseUrl) {
            const links = [];
            
            // Patrones para encontrar feeds
            const patterns = [
                /<link[^>]*type=["'](application\/rss\+xml|application\/atom\+xml|application\/xml|text\/xml)["'][^>]*href=["']([^"']+)["']/gi,
                /<link[^>]*href=["']([^"']+\.(rss|xml|atom))["'][^>]*type=["'](application\/rss\+xml|application\/atom\+xml)["']/gi,
                /<a[^>]*href=["']([^"']+\.(rss|xml|atom))["'][^>]*>.*?RSS.*?<\/a>/gi,
                /<a[^>]*href=["']([^"']*feed[^"']*)["'][^>]*>.*?(RSS|Atom|Feed).*?<\/a>/gi
            ];
            
            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(html)) !== null) {
                    let url = match[2] || match[1];
                    
                    // Convertir URL relativa a absoluta
                    if (url.startsWith('/')) {
                        const base = new URL(baseUrl);
                        url = base.origin + url;
                    } else if (!url.includes('://')) {
                        const base = new URL(baseUrl);
                        url = base.origin + '/' + url.replace(/^\//, '');
                    }
                    
                    if (!links.includes(url)) {
                        links.push(url);
                    }
                }
            }
            
            return links;
        },
        
        // Extraer título del HTML
        extractTitleFromHtml(html) {
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch && titleMatch[1]) {
                return titleMatch[1].trim().replace(/[\r\n]/g, ' ');
            }
            return null;
        },
        
        // Probar si una URL de feed es válida
        async testFeedUrl(url) {
            try {
                // Usar proxy CORS
                const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxyUrl, { 
                    method: 'GET',
                    headers: { 'Accept': 'application/xml, application/rss+xml, application/atom+xml' }
                });
                
                if (!response.ok) return false;
                
                const data = await response.json();
                const content = data.contents;
                
                // Verificar si es XML/RSS válido
                if (content.includes('<rss') || 
                    content.includes('<feed') || 
                    content.includes('<rdf:RDF') ||
                    content.includes('<?xml')) {
                    return true;
                }
                
                return false;
            } catch (error) {
                console.warn(`Error probando feed ${url}:`, error.message);
                return false;
            }
        },
        
        // Cargar un feed individual
        async loadFeed(blog) {
            try {
                console.log(`Cargando feed: ${blog.feedUrl}`);
                
                // Usar proxy para evitar CORS
                const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(blog.feedUrl)}`;
                const response = await fetch(proxyUrl);
                
                if (!response.ok) {
                    console.warn(`Error cargando feed ${blog.feedUrl}: ${response.status}`);
                    return [];
                }
                
                const data = await response.json();
                const xml = data.contents;
                
                // Parsear el feed
                const feedPosts = this.parseFeed(xml, blog);
                
                // Añadir posts al feed general
                this.posts = [...feedPosts, ...this.posts]
                    .filter((post, index, self) => 
                        index === self.findIndex(p => p.link === post.link)
                    )
                    .sort((a, b) => new Date(b.date) - new Date(a.date))
                    .slice(0, 100); // Limitar a 100 posts máximo
                
                return feedPosts;
                
            } catch (error) {
                console.error(`Error cargando feed ${blog.feedUrl}:`, error);
                return [];
            }
        },
        
        // Cargar todos los feeds
        async loadAllFeeds() {
            if (this.blogs.length === 0) return;
            
            this.isLoading = true;
            this.posts = []; // Limpiar posts anteriores
            
            console.log(`Cargando ${this.blogs.length} feeds...`);
            
            // Cargar feeds en paralelo (con límite)
            const promises = this.blogs.map(blog => this.loadFeed(blog));
            const results = await Promise.allSettled(promises);
            
            // Contar resultados
            const successful = results.filter(r => r.status === 'fulfilled').length;
            console.log(`Carga completada: ${successful}/${this.blogs.length} feeds cargados`);
            
            this.isLoading = false;
        },
        
        // Parsear feed RSS/Atom
        parseFeed(xml, blog) {
            const posts = [];
            
            try {
                // Intentar como RSS
                let items = xml.match(/<item>[\s\S]*?<\/item>/gi);
                
                if (!items) {
                    // Intentar como Atom
                    items = xml.match(/<entry>[\s\S]*?<\/entry>/gi);
                }
                
                if (!items) {
                    // Intentar como RDF
                    items = xml.match(/<rss:item>[\s\S]*?<\/rss:item>/gi) || 
                            xml.match(/<item rdf:about[^>]*>[\s\S]*?<\/item>/gi);
                }
                
                if (items) {
                    for (const item of items.slice(0, 20)) { // Limitar a 20 posts por feed
                        const post = {
                            id: blog.id + '_' + Date.now() + Math.random(),
                            blogUrl: blog.url,
                            blogTitle: blog.title,
                            title: this.extractFromXml(item, ['title', 'dc:title']),
                            link: this.extractFromXml(item, ['link', 'guid']),
                            date: this.extractFromXml(item, ['pubDate', 'dc:date', 'published', 'updated']),
                            author: this.extractFromXml(item, ['dc:creator', 'author', 'name']),
                            excerpt: this.extractFromXml(item, ['description', 'content:encoded', 'summary', 'content'])
                        };
                        
                        // Limpiar y formatear
                        post.excerpt = this.cleanHtml(post.excerpt || '').substring(0, 300) + '...';
                        post.date = post.date || new Date().toISOString();
                        
                        // Solo añadir si tiene link
                        if (post.link && post.link.startsWith('http')) {
                            posts.push(post);
                        }
                    }
                }
            } catch (error) {
                console.error('Error parseando feed:', error);
            }
            
            return posts;
        },
        
        // Extraer contenido de XML
        extractFromXml(xml, tags) {
            for (const tag of tags) {
                const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i');
                const match = xml.match(pattern);
                if (match && match[1]) {
                    return this.cleanText(match[1].trim());
                }
            }
            return '';
        },
        
        // Limpiar texto
        cleanText(text) {
            return text
                .replace(/<!\[CDATA\[(.*?)\]\]>/gi, '$1')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        },
        
        // Limpiar HTML (más seguro)
        cleanHtml(html) {
            const temp = document.createElement('div');
            temp.innerHTML = html;
            return temp.textContent || temp.innerText || '';
        },
        
        // Formatear fecha
        formatDate(dateString) {
            if (!dateString) return 'Fecha desconocida';
            
            try {
                const date = new Date(dateString);
                return date.toLocaleDateString('es-ES', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            } catch (error) {
                return dateString;
            }
        },
        
        // Extraer dominio de URL
        extractDomain(url) {
            try {
                const domain = new URL(url).hostname;
                return domain.replace(/^www\./, '');
            } catch {
                return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            }
        },
        
        // Remover blog
        removeBlog(blogId) {
            this.blogs = this.blogs.filter(b => b.id !== blogId);
            this.saveBlogs();
            
            // Recargar posts sin el blog eliminado
            if (this.blogs.length > 0) {
                this.loadAllFeeds();
            } else {
                this.posts = [];
            }
            
            this.showMessage('Blog eliminado', 'success');
        },
        
        // Mostrar mensajes
        showMessage(text, type) {
            this.message = text;
            this.messageType = type === 'error' ? 'error-message' : 
                              type === 'success' ? 'success-message' : '';
        }
    };
}