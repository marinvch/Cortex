<?php
/**
 * Plugin Name: My Site Custom
 * Plugin URI:  https://example.com
 * Description: Custom functionality for this site.
 * Version:     1.0.0
 * Author:      Example Author
 * License:     GPL-2.0+
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

add_action( 'init', 'mysite_register_post_types' );

function mysite_register_post_types(): void {
    register_post_type( 'mysite_product', [
        'labels'   => [ 'name' => __( 'Products', 'mysite' ) ],
        'public'   => true,
        'supports' => [ 'title', 'editor', 'thumbnail' ],
    ] );
}
